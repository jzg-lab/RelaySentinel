from __future__ import annotations

from datetime import datetime, timedelta, timezone
import importlib


def test_predicts_pool_remaining_hours_from_recent_snapshots():
    quota = importlib.import_module("relay_sentinel.domain.quota")
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    prediction = quota.predict_pool_quota(
        current={
            "checked_at": now,
            "five_hour_remaining_percent": 18.0,
            "seven_day_remaining_percent": 86.7,
        },
        history=[
            {
                "checked_at": now - timedelta(hours=1),
                "five_hour_remaining_percent": 21.75,
                "seven_day_remaining_percent": 89.5,
            },
            {
                "checked_at": now - timedelta(hours=3),
                "five_hour_remaining_percent": 26.0,
                "seven_day_remaining_percent": 91.0,
            },
        ],
    )

    assert prediction["five_hour"]["burn_rate_1h_percent_per_hour"] == 3.75
    assert prediction["five_hour"]["hours_remaining"] == 4.8
    assert prediction["seven_day"]["burn_rate_1h_percent_per_hour"] == 2.8
    assert prediction["seven_day"]["hours_remaining"] == 30.96
    assert prediction["should_alert"] is True


def test_zero_burn_rate_never_divides_by_zero_or_alerts():
    quota = importlib.import_module("relay_sentinel.domain.quota")
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    prediction = quota.predict_pool_quota(
        current={
            "checked_at": now,
            "five_hour_remaining_percent": 98.5,
            "seven_day_remaining_percent": 86.7,
        },
        history=[
            {
                "checked_at": now - timedelta(hours=1),
                "five_hour_remaining_percent": 98.5,
                "seven_day_remaining_percent": 86.7,
            }
        ],
    )

    assert prediction["five_hour"]["hours_remaining"] == float("inf")
    assert prediction["seven_day"]["hours_remaining"] == float("inf")
    assert prediction["should_alert"] is False
    assert "暂不可耗尽" in prediction["summary"]


def test_quota_summary_matches_mobile_alert_copy_shape():
    quota = importlib.import_module("relay_sentinel.domain.quota")
    now = datetime(2026, 5, 31, 10, 0, 33, tzinfo=timezone.utc)

    prediction = quota.predict_pool_quota(
        current={
            "checked_at": now,
            "five_hour_remaining_percent": 98.5,
            "seven_day_remaining_percent": 86.7,
        },
        history=[
            {
                "checked_at": now - timedelta(hours=1),
                "five_hour_remaining_percent": 98.5,
                "seven_day_remaining_percent": 86.7,
            },
            {
                "checked_at": now - timedelta(hours=3),
                "five_hour_remaining_percent": 98.5,
                "seven_day_remaining_percent": 86.7,
            },
        ],
        account_health={"success": 44, "total": 45, "failed": 1},
        display_timezone="Asia/Shanghai",
    )

    summary = prediction["summary"]
    assert "概览" in summary
    assert "账号：44/45 成功，1 失败" in summary
    assert "时间：2026-05-31 18:00:33" in summary
    assert "5H额度" in summary
    assert "总剩余：98.5%" in summary
    assert "7D额度" in summary
    assert "总剩余：86.7%" in summary
    assert "预测" in summary
    assert "近 1 小时：0.0%/小时" in summary
    assert "过去 1 小时消耗速度：0.0%/小时" in summary


def test_alert_cooling_suppresses_repeated_notifications():
    alerts = importlib.import_module("relay_sentinel.domain.alerts")
    now = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

    first = alerts.evaluate_alert(
        target_id="pool-1",
        rule_id="pool-quota-hours",
        is_triggered=True,
        now=now,
        previous_events=[],
        cooldown_seconds=21600,
    )
    second = alerts.evaluate_alert(
        target_id="pool-1",
        rule_id="pool-quota-hours",
        is_triggered=True,
        now=now + timedelta(hours=2),
        previous_events=[first],
        cooldown_seconds=21600,
    )
    third = alerts.evaluate_alert(
        target_id="pool-1",
        rule_id="pool-quota-hours",
        is_triggered=True,
        now=now + timedelta(hours=7),
        previous_events=[first, second],
        cooldown_seconds=21600,
    )

    assert first["action"] == "send"
    assert second["action"] == "cooldown_skip"
    assert third["action"] == "send"


def test_webhook_payload_contains_renewal_or_contact_information():
    notifier = importlib.import_module("relay_sentinel.notifications.webhook")

    payload = notifier.render_webhook_message(
        {
            "target_kind": "upstream",
            "target_name": "群主 A 的 Sub2API",
            "platform": "sub2api",
            "current_value": 4.1,
            "threshold_value": 10,
            "unit": "USD",
            "renewal": {"kind": "contact_owner", "instructions": "群内 @owner，最低充值 $20"},
        }
    )

    text = payload["text"]
    assert "群主 A 的 Sub2API" in text
    assert "4.1" in text
    assert "10" in text
    assert "联系群主" in text
    assert "群内 @owner" in text


def test_webhook_payload_includes_payment_link_without_claiming_auto_payment():
    notifier = importlib.import_module("relay_sentinel.notifications.webhook")

    payload = notifier.render_webhook_message(
        {
            "target_kind": "upstream",
            "target_name": "可直充 New API",
            "platform": "new_api",
            "current_value": 8,
            "threshold_value": 20,
            "unit": "CNY",
            "renewal": {
                "kind": "payment_link",
                "label": "打开充值页面",
                "url": "https://new-api.example.com/topup",
            },
        }
    )

    text = payload["text"]
    assert "可直充 New API" in text
    assert "打开充值页面" in text
    assert "https://new-api.example.com/topup" in text
    assert "自动支付" not in text
    assert "已续费" not in text
