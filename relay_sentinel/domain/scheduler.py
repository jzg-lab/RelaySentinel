from __future__ import annotations

from datetime import datetime
from typing import Any


def select_due_checks(*, now: datetime, targets: list[dict[str, Any]]) -> list[dict[str, str]]:
    due: list[dict[str, str]] = []
    for target in targets:
        kind = target.get("kind")
        if kind == "upstream" and _is_due(
            now,
            target.get("last_balance_checked_at"),
            int(target.get("check_interval_seconds", 1800)),
        ):
            due.append({"target_id": target["id"], "kind": "upstream", "check_type": "balance"})
        if kind == "pool":
            if _is_due(
                now,
                target.get("last_health_checked_at"),
                int(target.get("health_check_interval_seconds", 600)),
            ):
                due.append({"target_id": target["id"], "kind": "pool", "check_type": "health"})
            if _is_due(
                now,
                target.get("last_quota_checked_at"),
                int(target.get("quota_check_interval_seconds", 5400)),
            ):
                due.append({"target_id": target["id"], "kind": "pool", "check_type": "quota"})
    return due


def _is_due(now: datetime, last_checked_at: datetime | None, interval_seconds: int) -> bool:
    if last_checked_at is None:
        return True
    return (now - last_checked_at).total_seconds() >= interval_seconds

