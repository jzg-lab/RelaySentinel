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
