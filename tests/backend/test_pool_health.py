from __future__ import annotations

import importlib


def test_pool_health_summary_matches_expected_owner_message():
    health = importlib.import_module("relay_sentinel.domain.pool_health")

    summary = health.summarize_account_health(
        checked_at="2026-05-31T18:00:33+08:00",
        accounts=[
            {"id": "acc-1", "status": "ok"},
            {"id": "acc-2", "status": "ok"},
            {"id": "acc-3", "status": "failed"},
        ],
    )

    assert summary["total"] == 3
    assert summary["success"] == 2
    assert summary["failed"] == 1
    assert summary["should_alert"] is True
    assert "账号：2/3 成功，1 失败" in summary["text"]
    assert "2026-05-31 18:00:33" in summary["text"]


def test_pool_health_does_not_require_error_taxonomy_for_v1():
    health = importlib.import_module("relay_sentinel.domain.pool_health")

    summary = health.summarize_account_health(
        checked_at="2026-05-31T18:00:33+08:00",
        accounts=[
            {"id": "acc-1", "status": "ok"},
            {"id": "acc-2", "status": "unknown_error", "error": "provider returned random html"},
        ],
    )

    assert summary["failed"] == 1
    assert summary["should_alert"] is True
    assert "unknown_error" not in summary["text"]
    assert "报错分类" not in summary["text"]


def test_pool_health_ok_accounts_do_not_alert():
    health = importlib.import_module("relay_sentinel.domain.pool_health")

    summary = health.summarize_account_health(
        checked_at="2026-05-31T18:00:33+08:00",
        accounts=[
            {"id": "acc-1", "status": "ok"},
            {"id": "acc-2", "status": "ok"},
        ],
    )

    assert summary["failed"] == 0
    assert summary["should_alert"] is False
