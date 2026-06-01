from __future__ import annotations

from datetime import datetime
from typing import Any


def summarize_account_health(*, checked_at: str, accounts: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(accounts)
    success = sum(1 for account in accounts if account.get("status") == "ok")
    failed = total - success
    checked_display = _format_checked_at(checked_at)
    text = f"概览\n账号：{success}/{total} 成功，{failed} 失败\n时间：{checked_display}"
    if failed:
        text += "\n有账号巡检失败，请人工查看账号池。"
    return {
        "total": total,
        "success": success,
        "failed": failed,
        "should_alert": failed > 0,
        "text": text,
    }


def _format_checked_at(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.strftime("%Y-%m-%d %H:%M:%S")

