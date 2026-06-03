from __future__ import annotations

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from relay_sentinel.adapters.errors import AdapterAuthBlockedError, AdapterAuthError
from relay_sentinel.adapters.new_api import NewAPIAdapter
from relay_sentinel.adapters.sub2api import Sub2APIAdapter
from relay_sentinel.domain.alerts import evaluate_alert
from relay_sentinel.domain.pool_health import summarize_account_health
from relay_sentinel.domain.quota import predict_pool_quota
from relay_sentinel.domain.scheduler import select_due_checks
from relay_sentinel.storage import Store, utc_now_iso

logger = logging.getLogger(__name__)

ALLOWED_TARGET_PLATFORMS = {"new_api", "sub2api"}
ALLOWED_RENEWALS = {"manual", "contact_owner", "payment_link"}
ALLOWED_QUOTA_SOURCES = {"cliproxyapi", "cpa"}


def create_app(settings: Optional[Dict[str, Any]] = None) -> FastAPI:
    settings = settings or {}
    store = Store(
        database_url=settings.get("database_url", "sqlite:///:memory:"),
        secret_key=settings.get("secret_key", "dev-secret"),
    )

    scheduler_enabled = not bool(settings.get("disable_scheduler", False))
    scheduler_tick_seconds = int(settings.get("scheduler_tick_seconds", 60))
    notification_dry_run = bool(settings.get("notification_dry_run", False))
    api_key = settings.get("api_key")
    adapter_factory = settings.get("adapter_factory") or _default_adapter_factory
    pool_checker_factory = settings.get("pool_checker_factory") or _default_pool_checker_factory
    webhook_transport = settings.get("webhook_transport")

    # ------------------------------------------------------------------
    # internal check orchestrators (shared by routes and scheduler)
    # ------------------------------------------------------------------

    async def _execute_upstream_balance_check(upstream_id: str) -> Dict[str, Any]:
        upstream = _get_upstream_or_404(store, upstream_id)
        credential = store.get_upstream_credential(upstream_id) or {}
        checked_at = utc_now_iso()
        try:
            adapter = adapter_factory(upstream, credential)
            signal = await adapter.fetch_balance()
        except AdapterAuthBlockedError as exc:
            store.record_upstream_balance_check(upstream_id, status="blocked", checked_at=checked_at)
            return {
                "target_id": upstream_id,
                "kind": "upstream",
                "check_type": "balance",
                "result": "blocked",
                "message": str(exc),
                "checked_at": checked_at,
            }
        except (AdapterAuthError, ValueError) as exc:
            store.record_upstream_balance_check(upstream_id, status="failed", checked_at=checked_at)
            return {
                "target_id": upstream_id,
                "kind": "upstream",
                "check_type": "balance",
                "result": "failed",
                "message": str(exc),
                "checked_at": checked_at,
            }

        threshold = upstream.get("threshold") or {}
        is_triggered = _threshold_triggered(float(signal.value), threshold)
        status = "low_balance" if is_triggered else "active"
        store.record_upstream_balance_check(upstream_id, status=status, checked_at=checked_at)
        decision = evaluate_alert(
            target_id=upstream_id,
            rule_id="upstream-low-balance",
            is_triggered=is_triggered,
            now=_parse_datetime(checked_at),
            previous_events=store.list_alert_events(target_id=upstream_id),
            cooldown_seconds=int(upstream.get("alert_cooldown_seconds", 21600)),
        )
        if decision["action"] in {"send", "cooldown_skip"}:
            store.create_alert_event(
                {
                    "target_id": upstream_id,
                    "target_kind": "upstream",
                    "rule_id": "upstream-low-balance",
                    "severity": "warning",
                    "title": "上游余额不足",
                    "message": f"当前 {signal.value} {signal.unit}，低于 {threshold.get('value')} {threshold.get('unit', signal.unit)}",
                    "action": decision["action"],
                    "created_at": checked_at,
                }
            )
        return {
            "target_id": upstream_id,
            "kind": "upstream",
            "check_type": "balance",
            "result": "ok",
            "status": status,
            "signal": {
                "metric": signal.metric,
                "value": signal.value,
                "unit": signal.unit,
                "confidence": signal.confidence,
            },
            "alert_action": decision["action"],
            "checked_at": checked_at,
        }

    async def _execute_pool_health_check(pool_id: str) -> Dict[str, Any]:
        pool = _get_pool_or_404(store, pool_id)
        credential = store.get_pool_credential(pool_id) or {}
        checked_at = utc_now_iso()
        try:
            checker = pool_checker_factory(pool, credential)
            health_payload = await checker.fetch_account_health()
        except NotImplementedError:
            return {
                "target_id": pool_id,
                "kind": "pool",
                "check_type": "health",
                "result": "unsupported",
                "checked_at": checked_at,
            }
        except Exception as exc:
            store.record_pool_health_check(pool_id, status="failed", checked_at=checked_at)
            return {
                "target_id": pool_id,
                "kind": "pool",
                "check_type": "health",
                "result": "failed",
                "message": exc.__class__.__name__,
                "checked_at": checked_at,
            }

        health_checked_at = str(health_payload.get("checked_at") or checked_at)
        summary = summarize_account_health(
            checked_at=health_checked_at,
            accounts=health_payload.get("accounts") or [],
        )
        status = "unhealthy" if summary["should_alert"] else "active"
        store.record_pool_health_check(pool_id, status=status, checked_at=health_checked_at)
        decision = evaluate_alert(
            target_id=pool_id,
            rule_id="pool-health-failed",
            is_triggered=bool(summary["should_alert"]),
            now=_parse_datetime(health_checked_at),
            previous_events=store.list_alert_events(target_id=pool_id),
            cooldown_seconds=21600,
        )
        if decision["action"] in {"send", "cooldown_skip"}:
            store.create_alert_event(
                {
                    "target_id": pool_id,
                    "target_kind": "pool",
                    "rule_id": "pool-health-failed",
                    "severity": "warning",
                    "title": "号池账号巡检失败",
                    "message": summary["text"],
                    "action": decision["action"],
                    "created_at": health_checked_at,
                }
            )
        return {
            "target_id": pool_id,
            "kind": "pool",
            "check_type": "health",
            "result": "ok",
            "status": status,
            "summary": summary,
            "alert_action": decision["action"],
            "checked_at": health_checked_at,
        }

    async def _execute_pool_quota_check(pool_id: str) -> Dict[str, Any]:
        pool = _get_pool_or_404(store, pool_id)
        credential = store.get_pool_credential(pool_id) or {}
        checked_at = utc_now_iso()
        try:
            checker = pool_checker_factory(pool, credential)
            quota_payload = await checker.fetch_quota()
        except NotImplementedError:
            return {
                "target_id": pool_id,
                "kind": "pool",
                "check_type": "quota",
                "result": "unsupported",
                "checked_at": checked_at,
            }
        except Exception as exc:
            store.record_pool_quota_check(pool_id, status="failed", checked_at=checked_at)
            return {
                "target_id": pool_id,
                "kind": "pool",
                "check_type": "quota",
                "result": "failed",
                "message": exc.__class__.__name__,
                "checked_at": checked_at,
            }

        prediction = predict_pool_quota(
            current=quota_payload["current"],
            history=quota_payload.get("history") or [],
            alert_threshold_hours=float(pool.get("quota_alert_threshold_hours", 5)),
        )
        current_checked_at = quota_payload["current"]["checked_at"]
        checked_at_text = current_checked_at.isoformat() if isinstance(current_checked_at, datetime) else str(current_checked_at)
        status = "low_quota" if prediction["should_alert"] else "active"
        store.record_pool_quota_check(pool_id, status=status, checked_at=checked_at_text)
        decision = evaluate_alert(
            target_id=pool_id,
            rule_id="pool-quota-hours",
            is_triggered=bool(prediction["should_alert"]),
            now=_parse_datetime(checked_at_text),
            previous_events=store.list_alert_events(target_id=pool_id),
            cooldown_seconds=21600,
        )
        if decision["action"] in {"send", "cooldown_skip"}:
            store.create_alert_event(
                {
                    "target_id": pool_id,
                    "target_kind": "pool",
                    "rule_id": "pool-quota-hours",
                    "severity": "warning",
                    "title": "号池额度即将耗尽",
                    "message": prediction["summary"],
                    "action": decision["action"],
                    "created_at": checked_at_text,
                }
            )
        return {
            "target_id": pool_id,
            "kind": "pool",
            "check_type": "quota",
            "result": "ok",
            "status": status,
            "prediction": prediction,
            "alert_action": decision["action"],
            "checked_at": checked_at_text,
        }

    # ------------------------------------------------------------------
    # background scheduler
    # ------------------------------------------------------------------

    async def _scheduler_tick() -> None:
        now = datetime.now(timezone.utc)
        targets = store.list_upstreams() + store.list_pools()
        due = select_due_checks(now=now, targets=targets)
        if not due:
            return

        logger.info("scheduler tick: %d due check(s) at %s", len(due), now.isoformat())
        for item in due:
            try:
                if item["kind"] == "upstream" and item["check_type"] == "balance":
                    await _execute_upstream_balance_check(item["target_id"])
                elif item["kind"] == "pool":
                    if item["check_type"] == "health":
                        await _execute_pool_health_check(item["target_id"])
                    elif item["check_type"] == "quota":
                        await _execute_pool_quota_check(item["target_id"])
                logger.info(
                    "scheduler: %s %s %s completed",
                    item["kind"],
                    item["target_id"],
                    item["check_type"],
                )
            except HTTPException:
                # target was deleted between select_due_checks and dispatch — skip
                pass
            except Exception:
                logger.exception(
                    "scheduler: %s %s %s failed",
                    item["kind"],
                    item["target_id"],
                    item["check_type"],
                )

    async def _scheduler_loop(shutdown_event: asyncio.Event) -> None:
        # brief initial delay so the app can finish startup before first tick
        await asyncio.sleep(scheduler_tick_seconds)
        while not shutdown_event.is_set():
            try:
                await _scheduler_tick()
            except Exception:
                logger.exception("scheduler tick crashed, will retry next cycle")
            # sleep for the configured interval or until shutdown
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=scheduler_tick_seconds)
                break
            except asyncio.TimeoutError:
                pass

    @asynccontextmanager
    async def _lifespan(app_instance):
        nonlocal scheduler_enabled
        if scheduler_enabled:
            shutdown_event = asyncio.Event()
            task = asyncio.create_task(_scheduler_loop(shutdown_event))
            app_instance.state.scheduler_started = True
            logger.info("scheduler started (tick=%ds)", scheduler_tick_seconds)
            try:
                yield
            finally:
                shutdown_event.set()
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                logger.info("scheduler stopped")
        else:
            app_instance.state.scheduler_started = False
            yield

    # ------------------------------------------------------------------
    # FastAPI app
    # ------------------------------------------------------------------

    app = FastAPI(title="RelaySentinel", lifespan=_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["authorization", "content-type", "x-relay-sentinel-key"],
    )
    app.state.store = store
    app.state.scheduler_enabled = scheduler_enabled
    app.state.scheduler_started = False  # set by lifespan on actual start
    app.state.notification_dry_run = notification_dry_run
    app.state.api_key = api_key
    app.state.adapter_factory = adapter_factory
    app.state.pool_checker_factory = pool_checker_factory
    app.state.webhook_transport = webhook_transport

    @app.middleware("http")
    async def api_key_middleware(request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        if app.state.api_key and request.url.path.startswith("/api/"):
            expected = f"Bearer {app.state.api_key}"
            provided = request.headers.get("authorization") or ""
            fallback = request.headers.get("x-relay-sentinel-key") or ""
            if not (
                secrets.compare_digest(provided, expected)
                or secrets.compare_digest(fallback, app.state.api_key)
            ):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": "Invalid request body."})

    # -- upstream routes ---------------------------------------------------

    @app.post("/api/upstreams", status_code=201)
    async def create_upstream(payload: Dict[str, Any]) -> Dict[str, Any]:
        _validate_upstream(payload, partial=False)
        return store.create_upstream(payload)

    @app.get("/api/upstreams")
    async def list_upstreams() -> List[Dict[str, Any]]:
        return store.list_upstreams()

    @app.get("/api/upstreams/{upstream_id}")
    async def get_upstream(upstream_id: str) -> Dict[str, Any]:
        return _get_upstream_or_404(store, upstream_id)

    @app.patch("/api/upstreams/{upstream_id}")
    async def patch_upstream(upstream_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        current = _get_upstream_or_404(store, upstream_id)
        candidate = {**current, **payload}
        _validate_upstream(candidate, partial=False)
        updated = store.update_upstream(upstream_id, payload)
        if updated is None:
            raise HTTPException(status_code=404, detail="Upstream not found")
        return updated

    @app.delete("/api/upstreams/{upstream_id}", status_code=204)
    async def delete_upstream(upstream_id: str) -> Response:
        if not store.delete_upstream(upstream_id):
            raise HTTPException(status_code=404, detail="Upstream not found")
        return Response(status_code=204)

    @app.post("/api/upstreams/{upstream_id}/test")
    async def test_upstream(upstream_id: str) -> Dict[str, Any]:
        _get_upstream_or_404(store, upstream_id)
        return {"target_id": upstream_id, "kind": "upstream", "result": "unsupported"}

    @app.post("/api/upstreams/{upstream_id}/run-balance-check")
    async def run_upstream_balance_check(upstream_id: str) -> Dict[str, Any]:
        return await _execute_upstream_balance_check(upstream_id)

    # -- pool routes -------------------------------------------------------

    @app.post("/api/pools", status_code=201)
    async def create_pool(payload: Dict[str, Any]) -> Dict[str, Any]:
        _validate_pool(payload, partial=False)
        return store.create_pool(payload)

    @app.get("/api/pools")
    async def list_pools() -> List[Dict[str, Any]]:
        return store.list_pools()

    @app.get("/api/pools/{pool_id}")
    async def get_pool(pool_id: str) -> Dict[str, Any]:
        return _get_pool_or_404(store, pool_id)

    @app.patch("/api/pools/{pool_id}")
    async def patch_pool(pool_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        current = _get_pool_or_404(store, pool_id)
        candidate = {**current, **payload}
        _validate_pool(candidate, partial=False)
        updated = store.update_pool(pool_id, payload)
        if updated is None:
            raise HTTPException(status_code=404, detail="Pool not found")
        return updated

    @app.delete("/api/pools/{pool_id}", status_code=204)
    async def delete_pool(pool_id: str) -> Response:
        if not store.delete_pool(pool_id):
            raise HTTPException(status_code=404, detail="Pool not found")
        return Response(status_code=204)

    @app.post("/api/pools/{pool_id}/quota-sources", status_code=201)
    async def create_quota_source(pool_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        _get_pool_or_404(store, pool_id)
        _validate_quota_source(payload)
        return store.create_quota_source(pool_id, payload)

    @app.post("/api/pools/{pool_id}/test")
    async def test_pool(pool_id: str) -> Dict[str, Any]:
        _get_pool_or_404(store, pool_id)
        return {"target_id": pool_id, "kind": "pool", "result": "unsupported"}

    @app.post("/api/pools/{pool_id}/run-health-check")
    async def run_pool_health_check(pool_id: str) -> Dict[str, Any]:
        return await _execute_pool_health_check(pool_id)

    @app.post("/api/pools/{pool_id}/run-quota-check")
    async def run_pool_quota_check(pool_id: str) -> Dict[str, Any]:
        return await _execute_pool_quota_check(pool_id)

    # -- mobile home -------------------------------------------------------

    @app.get("/api/mobile/home")
    async def mobile_home() -> Dict[str, Any]:
        return {
            "upstreams": store.list_upstreams(),
            "pools": store.list_pools(),
            "alerts": store.list_alert_events(status="open"),
            "default_business_view": "upstreams",
        }

    # -- notification channels ---------------------------------------------

    @app.post("/api/notification-channels", status_code=201)
    async def create_notification_channel(payload: Dict[str, Any]) -> Dict[str, Any]:
        _validate_notification_channel(payload, partial=False)
        return store.create_notification_channel(payload)

    @app.get("/api/notification-channels")
    async def list_notification_channels() -> List[Dict[str, Any]]:
        return store.list_notification_channels()

    @app.get("/api/notification-channels/{channel_id}")
    async def get_notification_channel(channel_id: str) -> Dict[str, Any]:
        return _get_channel_or_404(store, channel_id)

    @app.patch("/api/notification-channels/{channel_id}")
    async def patch_notification_channel(channel_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        _validate_notification_channel(payload, partial=True)
        updated = store.update_notification_channel(channel_id, payload)
        if updated is None:
            raise HTTPException(status_code=404, detail="Notification channel not found")
        return updated

    @app.post("/api/notification-channels/{channel_id}/test")
    async def test_notification_channel(channel_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        channel = _get_channel_or_404(store, channel_id)
        secret = store.get_notification_channel_secret(channel_id) or {}
        url = secret.get("url", "")
        if app.state.notification_dry_run:
            return {"status": "dry_run", "message": payload.get("text", "")}
        result = await _deliver_webhook(
            url=url,
            payload={"text": payload.get("text", "")},
            transport=webhook_transport,
        )
        store.create_notification_delivery(
            {
                "channel_id": channel["id"],
                "status": result["status"],
                "status_code": result.get("status_code"),
                "error": result.get("error"),
            }
        )
        if result["status"] == "failed":
            return JSONResponse(status_code=502, content={"status": "failed"})
        return {"status": "sent"}

    @app.get("/api/notification-channels/{channel_id}/deliveries")
    async def list_notification_deliveries(channel_id: str) -> Dict[str, Any]:
        _get_channel_or_404(store, channel_id)
        return {"items": store.list_notification_deliveries(channel_id)}

    # -- alert events ------------------------------------------------------

    @app.post("/api/alerts/events", status_code=201)
    async def create_alert_event(payload: Dict[str, Any]) -> Dict[str, Any]:
        return store.create_alert_event(payload)

    @app.get("/api/alerts/events")
    async def list_alert_events(
        target_id: Optional[str] = None,
        status: Optional[str] = None,
        since: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {"items": store.list_alert_events(target_id=target_id, status=status, since=since)}

    @app.post("/api/alerts/events/{event_id}/ack")
    async def ack_alert_event(event_id: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return _update_alert_or_404(store, event_id, status="acknowledged", action="ack", note=(payload or {}).get("note"))

    @app.post("/api/alerts/events/{event_id}/snooze")
    async def snooze_alert_event(event_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return _update_alert_or_404(store, event_id, status="snoozed", action="snooze", until=payload.get("until"))

    @app.post("/api/alerts/events/{event_id}/rerun", status_code=202)
    async def rerun_alert_event(event_id: str) -> Dict[str, Any]:
        event = _get_alert_or_404(store, event_id)
        store.update_alert_status(event_id, status=event["status"], action="rerun")
        return {"status": "accepted"}

    @app.post("/api/alerts/events/{event_id}/resolve")
    async def resolve_alert_event(event_id: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return _update_alert_or_404(store, event_id, status="resolved", action="resolve", note=(payload or {}).get("note"))

    @app.get("/api/alerts/events/{event_id}/actions")
    async def list_alert_actions(event_id: str) -> Dict[str, Any]:
        _get_alert_or_404(store, event_id)
        return {"items": store.list_alert_actions(event_id)}

    @app.post("/api/alerts/evaluate")
    async def evaluate_alert_route(payload: Dict[str, Any]) -> Dict[str, Any]:
        now = _parse_datetime(payload["now"])
        previous = store.list_alert_events(target_id=payload["target_id"])
        decision = evaluate_alert(
            target_id=payload["target_id"],
            rule_id=payload["rule_id"],
            is_triggered=bool(payload["is_triggered"]),
            now=now,
            previous_events=previous,
            cooldown_seconds=int(payload.get("cooldown_seconds", 21600)),
        )
        if decision["action"] in {"send", "cooldown_skip"}:
            store.create_alert_event(
                {
                    "target_id": payload["target_id"],
                    "target_kind": payload.get("target_kind", "upstream"),
                    "rule_id": payload["rule_id"],
                    "severity": payload.get("severity", "warning"),
                    "title": payload.get("title", "告警评估"),
                    "message": payload.get("message", ""),
                    "action": decision["action"],
                    "created_at": now.isoformat(),
                }
            )
        return decision

    return app


# ------------------------------------------------------------------
# validation helpers
# ------------------------------------------------------------------

def _validate_upstream(payload: Dict[str, Any], *, partial: bool) -> None:
    _require(payload, ["name", "platform", "base_url", "threshold", "renewal"])
    if payload.get("platform") not in ALLOWED_TARGET_PLATFORMS:
        _invalid("Upstream platform only supports new_api or sub2api; CLIProxyAPI/CPA are not external upstreams.")
    _validate_http_url(payload.get("base_url"))
    threshold = payload.get("threshold") or {}
    if float(threshold.get("value", 0)) <= 0:
        _invalid("threshold.value must be greater than 0.")
    renewal = payload.get("renewal") or {}
    if renewal.get("kind") not in ALLOWED_RENEWALS:
        _invalid("renewal.kind must be manual, contact_owner, or payment_link.")
    if int(payload.get("check_interval_seconds", 1800)) <= 0:
        _invalid("check_interval_seconds must be greater than 0.")


def _validate_pool(payload: Dict[str, Any], *, partial: bool) -> None:
    _require(payload, ["name", "platform", "base_url", "quota_alert_threshold_hours"])
    if payload.get("platform") not in ALLOWED_TARGET_PLATFORMS:
        _invalid("Pool platform only supports new_api or sub2api; CLIProxyAPI/CPA must be quota sources.")
    _validate_http_url(payload.get("base_url"))
    if float(payload.get("quota_alert_threshold_hours", 0)) <= 0:
        _invalid("quota_alert_threshold_hours must be greater than 0.")
    if int(payload.get("health_check_interval_seconds", 600)) <= 0:
        _invalid("health_check_interval_seconds must be greater than 0.")
    if int(payload.get("quota_check_interval_seconds", 5400)) <= 0:
        _invalid("quota_check_interval_seconds must be greater than 0.")


def _validate_quota_source(payload: Dict[str, Any]) -> None:
    _require(payload, ["kind", "base_url"])
    if payload.get("kind") not in ALLOWED_QUOTA_SOURCES:
        _invalid("quota source kind must be cliproxyapi or cpa.")
    _validate_http_url(payload.get("base_url"))


def _validate_notification_channel(payload: Dict[str, Any], *, partial: bool) -> None:
    if not partial:
        _require(payload, ["name", "kind"])
    if "kind" in payload and payload.get("kind") != "webhook":
        _invalid("notification channel kind must be webhook.")
    if not partial and "url" not in payload:
        _invalid("url is required.")
    if "url" in payload:
        _validate_http_url(payload.get("url"))


def _require(payload: Dict[str, Any], keys: List[str]) -> None:
    missing = [key for key in keys if key not in payload]
    if missing:
        _invalid(f"Missing required field: {', '.join(missing)}")


def _validate_http_url(value: Any) -> None:
    parsed = urlparse(str(value or ""))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        _invalid("base_url/url must be a valid http or https URL.")


def _invalid(message: str) -> None:
    raise HTTPException(status_code=422, detail=message)


def _get_upstream_or_404(store: Store, item_id: str) -> Dict[str, Any]:
    item = store.get_upstream(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Upstream not found")
    return item


def _get_pool_or_404(store: Store, item_id: str) -> Dict[str, Any]:
    item = store.get_pool(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Pool not found")
    return item


def _get_channel_or_404(store: Store, item_id: str) -> Dict[str, Any]:
    item = store.get_notification_channel(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Notification channel not found")
    return item


def _get_alert_or_404(store: Store, item_id: str) -> Dict[str, Any]:
    item = store.get_alert_event(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Alert event not found")
    return item


def _update_alert_or_404(
    store: Store,
    event_id: str,
    *,
    status: str,
    action: str,
    note: Optional[str] = None,
    until: Optional[str] = None,
) -> Dict[str, Any]:
    item = store.update_alert_status(event_id, status=status, action=action, note=note, until=until)
    if item is None:
        raise HTTPException(status_code=404, detail="Alert event not found")
    return item


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _threshold_triggered(value: float, threshold: Dict[str, Any]) -> bool:
    operator = threshold.get("operator", "lt")
    threshold_value = float(threshold.get("value", 0))
    if operator == "lt":
        return value < threshold_value
    if operator == "lte":
        return value <= threshold_value
    if operator == "gt":
        return value > threshold_value
    if operator == "gte":
        return value >= threshold_value
    return False


def _default_adapter_factory(upstream: Dict[str, Any], credential: Dict[str, Any]):
    platform = upstream.get("platform")
    if platform == "new_api":
        token = credential.get("token") or credential.get("admin_token")
        if not token:
            raise ValueError("new_api upstream requires an admin token credential")
        return NewAPIAdapter(base_url=upstream["base_url"], admin_token=token)
    if platform == "sub2api":
        email = credential.get("email")
        password = credential.get("password")
        if not email or not password:
            raise ValueError("sub2api upstream requires email and password credentials")
        return Sub2APIAdapter(base_url=upstream["base_url"], email=email, password=password)
    raise ValueError("unsupported upstream platform")


def _default_pool_checker_factory(pool: Dict[str, Any], credential: Dict[str, Any]):
    return _UnsupportedPoolChecker()


class _UnsupportedPoolChecker:
    async def fetch_account_health(self):
        raise NotImplementedError

    async def fetch_quota(self):
        raise NotImplementedError


async def _deliver_webhook(
    *,
    url: str,
    payload: Dict[str, Any],
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(transport=transport, timeout=10) as client:
            response = await client.post(url, json=payload)
        if response.status_code >= 400:
            return {"status": "failed", "status_code": response.status_code}
        return {"status": "sent", "status_code": response.status_code}
    except httpx.HTTPError as exc:
        return {"status": "failed", "error": exc.__class__.__name__}
