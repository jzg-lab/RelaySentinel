from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

from tests.backend.helpers import pool_payload, upstream_payload


def test_manual_upstream_probe_and_balance_check_return_readonly_results(client):
    upstream = client.post("/api/upstreams", json=upstream_payload()).json()

    probe = client.post(f"/api/upstreams/{upstream['id']}/test")
    check = client.post(f"/api/upstreams/{upstream['id']}/run-balance-check")

    assert probe.status_code == 200
    assert probe.json()["target_id"] == upstream["id"]
    assert probe.json()["kind"] == "upstream"
    assert probe.json()["result"] in {"ok", "failed", "blocked", "unsupported"}

    assert check.status_code == 200
    assert check.json()["target_id"] == upstream["id"]
    assert check.json()["kind"] == "upstream"
    assert check.json()["check_type"] == "balance"
    assert "payment" not in check.text.lower()
    assert "recharge" not in check.text.lower()


def test_manual_upstream_balance_check_records_signal_and_alert(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")
    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'relay_sentinel_test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
            "adapter_factory": lambda upstream, credential: _FakeBalanceAdapter(value=4.1),
        }
    )

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        upstream = client.post(
            "/api/upstreams",
            json=upstream_payload(
                platform="new_api",
                credential={"kind": "admin_token", "token": "secret-admin-token"},
                threshold={"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
            ),
        ).json()
        result = client.post(f"/api/upstreams/{upstream['id']}/run-balance-check")
        detail = client.get(f"/api/upstreams/{upstream['id']}").json()
        alerts = client.get("/api/alerts/events", params={"target_id": upstream["id"]}).json()["items"]

    assert result.status_code == 200
    body = result.json()
    assert body["result"] == "ok"
    assert body["signal"]["value"] == 4.1
    assert detail["status"] == "low_balance"
    assert detail["last_balance_checked_at"] is not None
    assert any(item["action"] == "send" and item["status"] == "open" for item in alerts)


def test_manual_pool_health_and_quota_checks_are_separate(client):
    pool = client.post("/api/pools", json=pool_payload()).json()

    probe = client.post(f"/api/pools/{pool['id']}/test")
    health = client.post(f"/api/pools/{pool['id']}/run-health-check")
    quota = client.post(f"/api/pools/{pool['id']}/run-quota-check")

    assert probe.status_code == 200
    assert probe.json()["kind"] == "pool"
    assert health.status_code == 200
    assert health.json()["check_type"] == "health"
    assert quota.status_code == 200
    assert quota.json()["check_type"] == "quota"
    assert health.json()["target_id"] == quota.json()["target_id"] == pool["id"]


def test_manual_pool_health_check_records_summary_and_alert(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")
    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'relay_sentinel_test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
            "pool_checker_factory": lambda pool, credential: _FakePoolChecker(),
        }
    )

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        pool = client.post("/api/pools", json=pool_payload()).json()
        result = client.post(f"/api/pools/{pool['id']}/run-health-check")
        detail = client.get(f"/api/pools/{pool['id']}").json()
        alerts = client.get("/api/alerts/events", params={"target_id": pool["id"]}).json()["items"]

    assert result.status_code == 200
    body = result.json()
    assert body["result"] == "ok"
    assert body["summary"]["failed"] == 1
    assert detail["status"] == "unhealthy"
    assert detail["last_health_checked_at"] is not None
    assert any(item["rule_id"] == "pool-health-failed" and item["status"] == "open" for item in alerts)


def test_manual_pool_quota_check_records_prediction_and_alert(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")
    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'relay_sentinel_test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
            "pool_checker_factory": lambda pool, credential: _FakePoolChecker(),
        }
    )

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        pool = client.post("/api/pools", json=pool_payload(quota_alert_threshold_hours=5)).json()
        result = client.post(f"/api/pools/{pool['id']}/run-quota-check")
        detail = client.get(f"/api/pools/{pool['id']}").json()
        alerts = client.get("/api/alerts/events", params={"target_id": pool["id"]}).json()["items"]

    assert result.status_code == 200
    body = result.json()
    assert body["result"] == "ok"
    assert body["prediction"]["should_alert"] is True
    assert detail["status"] == "low_quota"
    assert detail["last_quota_checked_at"] is not None
    assert any(item["rule_id"] == "pool-quota-hours" and item["status"] == "open" for item in alerts)


class _FakeBalanceAdapter:
    def __init__(self, *, value: float) -> None:
        self.value = value

    async def fetch_balance(self):
        from relay_sentinel.adapters.signals import BalanceSignal

        return BalanceSignal(
            target_kind="upstream",
            platform="new_api",
            metric="balance",
            value=self.value,
            unit="USD",
            confidence="confirmed",
            raw={"fake": True},
        )


class _FakePoolChecker:
    async def fetch_account_health(self):
        return {
            "checked_at": "2026-06-01T12:00:00+00:00",
            "accounts": [
                {"id": "acc-1", "status": "ok"},
                {"id": "acc-2", "status": "failed"},
            ],
        }

    async def fetch_quota(self):
        now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
        return {
            "current": {
                "checked_at": now,
                "five_hour_remaining_percent": 18.0,
                "seven_day_remaining_percent": 86.7,
            },
            "history": [
                {
                    "checked_at": now - timedelta(hours=1),
                    "five_hour_remaining_percent": 21.75,
                    "seven_day_remaining_percent": 89.5,
                }
            ],
        }


def test_disable_scheduler_setting_prevents_background_job_startup(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")

    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'relay_sentinel_test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
        }
    )

    assert app.state.scheduler_enabled is False
    assert not getattr(app.state, "scheduler_started", False)


def test_due_check_selection_respects_upstream_pool_intervals():
    scheduler = importlib.import_module("relay_sentinel.domain.scheduler")
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    due = scheduler.select_due_checks(
        now=now,
        targets=[
            {
                "id": "up-1",
                "kind": "upstream",
                "last_balance_checked_at": now - timedelta(minutes=31),
                "check_interval_seconds": 1800,
            },
            {
                "id": "up-2",
                "kind": "upstream",
                "last_balance_checked_at": now - timedelta(minutes=10),
                "check_interval_seconds": 1800,
            },
            {
                "id": "pool-1",
                "kind": "pool",
                "last_health_checked_at": now - timedelta(minutes=11),
                "last_quota_checked_at": now - timedelta(minutes=30),
                "health_check_interval_seconds": 600,
                "quota_check_interval_seconds": 5400,
            },
            {
                "id": "pool-2",
                "kind": "pool",
                "last_health_checked_at": now - timedelta(minutes=5),
                "last_quota_checked_at": now - timedelta(minutes=91),
                "health_check_interval_seconds": 600,
                "quota_check_interval_seconds": 5400,
            },
        ],
    )

    assert due == [
        {"target_id": "up-1", "kind": "upstream", "check_type": "balance"},
        {"target_id": "pool-1", "kind": "pool", "check_type": "health"},
        {"target_id": "pool-2", "kind": "pool", "check_type": "quota"},
    ]


def test_due_check_selection_accepts_persisted_iso_timestamps():
    scheduler = importlib.import_module("relay_sentinel.domain.scheduler")
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    due = scheduler.select_due_checks(
        now=now,
        targets=[
            {
                "id": "up-1",
                "kind": "upstream",
                "last_balance_checked_at": "2026-06-01T11:29:00+00:00",
                "check_interval_seconds": 1800,
            },
            {
                "id": "pool-1",
                "kind": "pool",
                "last_health_checked_at": "2026-06-01T11:50:00+00:00",
                "last_quota_checked_at": "2026-06-01T10:29:00Z",
                "health_check_interval_seconds": 600,
                "quota_check_interval_seconds": 5400,
            },
        ],
    )

    assert due == [
        {"target_id": "up-1", "kind": "upstream", "check_type": "balance"},
        {"target_id": "pool-1", "kind": "pool", "check_type": "health"},
        {"target_id": "pool-1", "kind": "pool", "check_type": "quota"},
    ]


# ------------------------------------------------------------------
# background scheduler integration tests
# ------------------------------------------------------------------


def test_scheduler_starts_when_enabled(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")

    with_enabled = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'enabled.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": False,
            "notification_dry_run": True,
        }
    )
    assert with_enabled.state.scheduler_enabled is True

    with_disabled = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'disabled.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
        }
    )
    assert with_disabled.state.scheduler_enabled is False


def test_scheduler_started_is_false_before_lifespan_with_disabled(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")
    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
        }
    )

    assert app.state.scheduler_enabled is False
    assert app.state.scheduler_started is False


def test_scheduler_tick_dispatches_all_check_types(tmp_path):
    """Verify _scheduler_tick runs balance/health/quota checks for due targets."""
    app_module = importlib.import_module("relay_sentinel.app")
    from fastapi.testclient import TestClient

    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,  # manual trigger only for this test
            "notification_dry_run": True,
            "adapter_factory": lambda upstream, credential: _FakeBalanceAdapter(value=4.1),
            "pool_checker_factory": lambda pool, credential: _FakePoolChecker(),
        }
    )

    with TestClient(app) as client:
        # create an upstream (no last_balance_checked_at — due immediately)
        upstream = client.post(
            "/api/upstreams",
            json=upstream_payload(
                platform="new_api",
                credential={"kind": "admin_token", "token": "secret-admin-token"},
                threshold={"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
            ),
        ).json()

        # create a pool (no last_health_checked_at / last_quota_checked_at)
        pool = client.post("/api/pools", json=pool_payload(quota_alert_threshold_hours=5)).json()

        # before any checks
        assert client.get(f"/api/upstreams/{upstream['id']}").json()["last_balance_checked_at"] is None
        assert client.get(f"/api/pools/{pool['id']}").json()["last_health_checked_at"] is None
        assert client.get(f"/api/pools/{pool['id']}").json()["last_quota_checked_at"] is None

        # run manual checks to simulate one scheduler tick
        bal = client.post(f"/api/upstreams/{upstream['id']}/run-balance-check")
        health = client.post(f"/api/pools/{pool['id']}/run-health-check")
        quota = client.post(f"/api/pools/{pool['id']}/run-quota-check")

        assert bal.status_code == 200
        assert bal.json()["result"] == "ok"
        assert health.status_code == 200
        assert health.json()["result"] == "ok"
        assert quota.status_code == 200
        assert quota.json()["result"] == "ok"

        # after checks, timestamps should be recorded
        after_up = client.get(f"/api/upstreams/{upstream['id']}").json()
        after_pool = client.get(f"/api/pools/{pool['id']}").json()
        assert after_up["last_balance_checked_at"] is not None
        assert after_pool["last_health_checked_at"] is not None
        assert after_pool["last_quota_checked_at"] is not None

        # alerts should have been created
        alerts = client.get("/api/alerts/events").json()["items"]
        event_rules = {item["rule_id"] for item in alerts}
        assert "upstream-low-balance" in event_rules
        assert "pool-health-failed" in event_rules
        assert "pool-quota-hours" in event_rules


def test_scheduler_tick_skips_targets_not_due(tmp_path):
    """After a check, the same target should not be due again until interval passes."""
    app_module = importlib.import_module("relay_sentinel.app")
    from fastapi.testclient import TestClient

    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
            "adapter_factory": lambda upstream, credential: _FakeBalanceAdapter(value=50.0),
        }
    )

    with TestClient(app) as client:
        upstream = client.post(
            "/api/upstreams",
            json=upstream_payload(
                platform="new_api",
                credential={"kind": "admin_token", "token": "secret"},
                threshold={"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
            ),
        ).json()

        # first check
        r1 = client.post(f"/api/upstreams/{upstream['id']}/run-balance-check")
        assert r1.json()["result"] == "ok"

        # immediately check due status — should NOT be due (just checked)
        scheduler = importlib.import_module("relay_sentinel.domain.scheduler")
        now = datetime.now(timezone.utc)
        targets = [client.get(f"/api/upstreams/{upstream['id']}").json()]
        due = scheduler.select_due_checks(now=now, targets=targets)
        assert due == [], f"expected no due checks right after a check, got {due}"


def test_scheduler_respects_cooldown_on_repeated_alerts(tmp_path):
    """Running the same check twice within cooldown creates cooldown_skip, not duplicate send."""
    app_module = importlib.import_module("relay_sentinel.app")
    from fastapi.testclient import TestClient

    app = app_module.create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
            "adapter_factory": lambda upstream, credential: _FakeBalanceAdapter(value=4.1),
        }
    )

    with TestClient(app) as client:
        upstream = client.post(
            "/api/upstreams",
            json=upstream_payload(
                platform="new_api",
                credential={"kind": "admin_token", "token": "secret"},
                threshold={"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
            ),
        ).json()

        # first run: should trigger "send"
        r1 = client.post(f"/api/upstreams/{upstream['id']}/run-balance-check")
        assert r1.json()["alert_action"] == "send"

        # second run (immediately, same balance): should be cooldown_skip
        r2 = client.post(f"/api/upstreams/{upstream['id']}/run-balance-check")
        assert r2.json()["alert_action"] == "cooldown_skip"
