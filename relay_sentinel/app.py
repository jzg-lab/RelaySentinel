from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from relay_sentinel.domain.alerts import evaluate_alert
from relay_sentinel.storage import Store, utc_now_iso


ALLOWED_TARGET_PLATFORMS = {"new_api", "sub2api"}
ALLOWED_RENEWALS = {"manual", "contact_owner", "payment_link"}
ALLOWED_QUOTA_SOURCES = {"cliproxyapi", "cpa"}


def create_app(settings: Optional[Dict[str, Any]] = None) -> FastAPI:
    settings = settings or {}
    store = Store(
        database_url=settings.get("database_url", "sqlite:///:memory:"),
        secret_key=settings.get("secret_key", "dev-secret"),
    )
    app = FastAPI(title="RelaySentinel")
    app.state.store = store
    app.state.scheduler_enabled = not bool(settings.get("disable_scheduler", False))
    app.state.scheduler_started = bool(app.state.scheduler_enabled)
    app.state.notification_dry_run = bool(settings.get("notification_dry_run", False))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": "Invalid request body."})

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
        _get_upstream_or_404(store, upstream_id)
        return {
            "target_id": upstream_id,
            "kind": "upstream",
            "check_type": "balance",
            "result": "queued",
            "checked_at": utc_now_iso(),
        }

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
        _get_pool_or_404(store, pool_id)
        return {
            "target_id": pool_id,
            "kind": "pool",
            "check_type": "health",
            "result": "queued",
            "checked_at": utc_now_iso(),
        }

    @app.post("/api/pools/{pool_id}/run-quota-check")
    async def run_pool_quota_check(pool_id: str) -> Dict[str, Any]:
        _get_pool_or_404(store, pool_id)
        return {
            "target_id": pool_id,
            "kind": "pool",
            "check_type": "quota",
            "result": "queued",
            "checked_at": utc_now_iso(),
        }

    @app.get("/api/mobile/home")
    async def mobile_home() -> Dict[str, Any]:
        return {
            "upstreams": store.list_upstreams(),
            "pools": store.list_pools(),
            "alerts": store.list_alert_events(status="open"),
            "default_business_view": "upstreams",
        }

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
        _get_channel_or_404(store, channel_id)
        candidate = {**_get_channel_or_404(store, channel_id), **payload}
        _validate_notification_channel(candidate, partial=False)
        updated = store.update_notification_channel(channel_id, payload)
        if updated is None:
            raise HTTPException(status_code=404, detail="Notification channel not found")
        return updated

    @app.post("/api/notification-channels/{channel_id}/test")
    async def test_notification_channel(channel_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        _get_channel_or_404(store, channel_id)
        secret = store.get_notification_channel_secret(channel_id) or {}
        url = secret.get("url", "")
        if app.state.notification_dry_run:
            return {"status": "dry_run", "message": payload.get("text", "")}
        if "fail" in url:
            return JSONResponse(status_code=502, content={"status": "failed"})
        return {"status": "sent"}

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
    _require(payload, ["name", "kind"])
    if payload.get("kind") != "webhook":
        _invalid("notification channel kind must be webhook.")
    if not partial and "url" not in payload and "id" not in payload:
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
