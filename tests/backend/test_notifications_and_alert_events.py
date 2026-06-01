from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests.backend.helpers import notification_channel_payload, upstream_payload


def test_notification_channel_crud_and_dry_run_redacts_webhook_secret(client):
    created = client.post("/api/notification-channels", json=notification_channel_payload())

    assert created.status_code == 201
    channel = created.json()
    assert channel["kind"] == "webhook"
    assert channel["enabled"] is True
    assert "secret-webhook-token" not in created.text

    listed = client.get("/api/notification-channels")
    detail = client.get(f"/api/notification-channels/{channel['id']}")
    patched = client.patch(f"/api/notification-channels/{channel['id']}", json={"enabled": False})
    dry_run = client.post(
        f"/api/notification-channels/{channel['id']}/test",
        json={"text": "RelaySentinel dry-run: 余额低于阈值"},
    )

    assert listed.status_code == 200
    assert detail.status_code == 200
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    assert dry_run.status_code == 200
    assert dry_run.json()["status"] in {"sent", "dry_run"}

    combined = f"{listed.text}\n{detail.text}\n{patched.text}\n{dry_run.text}"
    assert "secret-webhook-token" not in combined


def test_failed_webhook_delivery_records_redacted_failure(client):
    channel = client.post(
        "/api/notification-channels",
        json=notification_channel_payload(url="https://notify.example.com/fail/secret-webhook-token"),
    ).json()

    result = client.post(
        f"/api/notification-channels/{channel['id']}/test",
        json={"text": "余额告警"},
    )

    assert result.status_code in {200, 502}
    body = result.json()
    assert body["status"] in {"failed", "dry_run"}
    assert "secret-webhook-token" not in result.text


def test_alert_event_lifecycle_ack_snooze_resolve_and_rerun(client):
    upstream = client.post("/api/upstreams", json=upstream_payload()).json()

    created = client.post(
        "/api/alerts/events",
        json={
            "target_id": upstream["id"],
            "target_kind": "upstream",
            "rule_id": "upstream-low-balance",
            "severity": "warning",
            "title": "上游余额不足",
            "message": "当前 4.1 USD，低于 10 USD",
            "created_at": "2026-06-01T12:00:00Z",
        },
    )

    assert created.status_code == 201
    event = created.json()

    listed = client.get("/api/alerts/events")
    ack = client.post(f"/api/alerts/events/{event['id']}/ack", json={"note": "我知道了"})
    snooze = client.post(f"/api/alerts/events/{event['id']}/snooze", json={"until": "2026-06-01T18:00:00Z"})
    rerun = client.post(f"/api/alerts/events/{event['id']}/rerun")
    resolved = client.post(f"/api/alerts/events/{event['id']}/resolve", json={"note": "已续费"})

    assert listed.status_code == 200
    assert any(item["id"] == event["id"] for item in listed.json()["items"])
    assert ack.status_code == 200
    assert ack.json()["status"] == "acknowledged"
    assert snooze.status_code == 200
    assert snooze.json()["status"] == "snoozed"
    assert rerun.status_code == 202
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"

    actions = client.get(f"/api/alerts/events/{event['id']}/actions")
    assert actions.status_code == 200
    assert [item["action"] for item in actions.json()["items"]] == ["ack", "snooze", "rerun", "resolve"]


def test_repeated_low_balance_within_cooldown_creates_cooldown_skip_event(client):
    upstream = client.post("/api/upstreams", json=upstream_payload()).json()

    first = client.post(
        "/api/alerts/evaluate",
        json={
            "target_id": upstream["id"],
            "rule_id": "upstream-low-balance",
            "is_triggered": True,
            "now": "2026-06-01T12:00:00Z",
            "cooldown_seconds": 21600,
        },
    )
    second = client.post(
        "/api/alerts/evaluate",
        json={
            "target_id": upstream["id"],
            "rule_id": "upstream-low-balance",
            "is_triggered": True,
            "now": "2026-06-01T14:00:00Z",
            "cooldown_seconds": 21600,
        },
    )

    assert first.status_code == 200
    assert first.json()["action"] == "send"
    assert second.status_code == 200
    assert second.json()["action"] == "cooldown_skip"

    events = client.get("/api/alerts/events", params={"target_id": upstream["id"]})
    assert events.status_code == 200
    assert any(item["action"] == "cooldown_skip" for item in events.json()["items"])


def test_alert_event_filtering_by_status_and_time_window(client):
    upstream = client.post("/api/upstreams", json=upstream_payload()).json()
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    for index, status in enumerate(["open", "resolved"]):
        event = client.post(
            "/api/alerts/events",
            json={
                "target_id": upstream["id"],
                "target_kind": "upstream",
                "rule_id": "upstream-low-balance",
                "severity": "warning",
                "title": f"余额告警 {index}",
                "message": "余额不足",
                "status": status,
                "created_at": (now - timedelta(hours=index)).isoformat(),
            },
        )
        assert event.status_code == 201

    open_events = client.get("/api/alerts/events", params={"status": "open"})
    recent_events = client.get("/api/alerts/events", params={"since": "2026-06-01T11:30:00Z"})

    assert open_events.status_code == 200
    assert all(item["status"] == "open" for item in open_events.json()["items"])
    assert recent_events.status_code == 200
    assert len(recent_events.json()["items"]) == 1
