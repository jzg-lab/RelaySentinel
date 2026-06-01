from __future__ import annotations


def upstream_payload(**overrides):
    payload = {
        "name": "词元 fast",
        "platform": "sub2api",
        "base_url": "https://ciyuan.fast",
        "credential": {
            "kind": "login",
            "email": "owner@example.com",
            "password": "secret-password",
        },
        "threshold": {"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
        "renewal": {"kind": "contact_owner", "instructions": "群内 @owner，最低充值 $20"},
    }
    payload.update(overrides)
    return payload


def pool_payload(**overrides):
    payload = {
        "name": "自营 Sub2API 号池",
        "platform": "sub2api",
        "base_url": "https://self.example.com",
        "credential": {"kind": "admin_token", "token": "secret-admin-token"},
        "quota_alert_threshold_hours": 5,
    }
    payload.update(overrides)
    return payload


def notification_channel_payload(**overrides):
    payload = {
        "name": "值班群",
        "kind": "webhook",
        "enabled": True,
        "url": "https://notify.example.com/bot/secret-webhook-token",
        "template": "default",
    }
    payload.update(overrides)
    return payload
