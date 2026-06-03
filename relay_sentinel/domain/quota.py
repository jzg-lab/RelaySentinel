from __future__ import annotations

from datetime import datetime, timezone, timedelta
from math import inf
from typing import Any


def predict_pool_quota(
    *,
    current: dict[str, Any],
    history: list[dict[str, Any]],
    account_health: dict[str, int] | None = None,
    display_timezone: str = "UTC",
    alert_threshold_hours: float = 5.0,
) -> dict[str, Any]:
    five_hour = _predict_bucket(current, history, "five_hour_remaining_percent")
    seven_day = _predict_bucket(current, history, "seven_day_remaining_percent")
    should_alert = (
        five_hour["hours_remaining"] != inf and five_hour["hours_remaining"] <= alert_threshold_hours
    ) or (
        seven_day["hours_remaining"] != inf and seven_day["hours_remaining"] <= alert_threshold_hours
    )
    return {
        "five_hour": five_hour,
        "seven_day": seven_day,
        "should_alert": should_alert,
        "summary": _summary(current, five_hour, seven_day, account_health, display_timezone),
    }


def _predict_bucket(current: dict[str, Any], history: list[dict[str, Any]], key: str) -> dict[str, float]:
    current_time = current["checked_at"]
    current_value = float(current[key])
    burn_rate = _burn_rate(current_time, current_value, _nearest_history(current_time, history, target_hours=1), key)
    three_hour_burn_rate = _burn_rate(
        current_time,
        current_value,
        _nearest_history(current_time, history, target_hours=3),
        key,
    )
    hours_remaining = inf if burn_rate <= 0 else round(current_value / burn_rate, 2)
    return {
        "remaining_percent": current_value,
        "burn_rate_1h_percent_per_hour": round(burn_rate, 2),
        "burn_rate_3h_percent_per_hour": round(three_hour_burn_rate, 2),
        "hours_remaining": hours_remaining,
    }


def _burn_rate(
    current_time: datetime,
    current_value: float,
    previous: dict[str, Any] | None,
    key: str,
) -> float:
    if previous is None:
        return 0.0
    elapsed_hours = max((current_time - previous["checked_at"]).total_seconds() / 3600, 0.0)
    if elapsed_hours == 0:
        return 0.0
    return max((float(previous[key]) - current_value) / elapsed_hours, 0.0)


def _nearest_history(
    current_time: datetime,
    history: list[dict[str, Any]],
    *,
    target_hours: int,
) -> dict[str, Any] | None:
    if not history:
        return None
    target_seconds = target_hours * 3600
    return min(history, key=lambda item: abs((current_time - item["checked_at"]).total_seconds() - target_seconds))


def _summary(
    current: dict[str, Any],
    five_hour: dict[str, float],
    seven_day: dict[str, float],
    account_health: dict[str, int] | None,
    display_timezone: str,
) -> str:
    checked_at = current["checked_at"]
    if checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=timezone.utc)
    target_tz = timezone(timedelta(hours=8)) if display_timezone == "Asia/Shanghai" else timezone.utc
    checked_display = checked_at.astimezone(target_tz).strftime("%Y-%m-%d %H:%M:%S")
    lines = ["概览"]
    if account_health:
        lines.append(
            f"账号：{account_health.get('success', 0)}/{account_health.get('total', 0)} 成功，"
            f"{account_health.get('failed', 0)} 失败"
        )
    lines.extend(
        [
            f"时间：{checked_display}",
            "5H额度",
            f"总剩余：{five_hour['remaining_percent']}%",
            "7D额度",
            f"总剩余：{seven_day['remaining_percent']}%",
            "预测",
            f"近 1 小时：{five_hour['burn_rate_1h_percent_per_hour']}%/小时",
            f"近 3 小时：{five_hour['burn_rate_3h_percent_per_hour']}%/小时",
        ]
    )
    if five_hour["hours_remaining"] == inf and seven_day["hours_remaining"] == inf:
        lines.append("当前消耗速度为 0，暂不可耗尽。")
    return "\n".join(lines)
