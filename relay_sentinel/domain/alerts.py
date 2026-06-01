from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def evaluate_alert(
    *,
    target_id: str,
    rule_id: str,
    is_triggered: bool,
    now: datetime,
    previous_events: list[dict[str, Any]],
    cooldown_seconds: int,
) -> dict[str, Any]:
    if not is_triggered:
        return {
            "target_id": target_id,
            "rule_id": rule_id,
            "action": "clear",
            "created_at": now,
        }

    last_send_at: datetime | None = None
    for event in previous_events:
        if event.get("target_id") != target_id or event.get("rule_id") != rule_id:
            continue
        if event.get("action") != "send":
            continue
        created_at = _parse_dt(event.get("created_at"))
        if created_at is not None and (last_send_at is None or created_at > last_send_at):
            last_send_at = created_at

    action = "send"
    if last_send_at is not None and (now - last_send_at).total_seconds() < cooldown_seconds:
        action = "cooldown_skip"

    return {
        "target_id": target_id,
        "rule_id": rule_id,
        "action": action,
        "created_at": now,
    }


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            normalized = value.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(normalized)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None

