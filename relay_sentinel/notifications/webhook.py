from __future__ import annotations

from typing import Any


def render_webhook_message(event: dict[str, Any]) -> dict[str, str]:
    renewal = event.get("renewal") or {}
    lines = [
        f"RelaySentinel 告警：{event.get('target_name')}",
        f"平台：{event.get('platform')}",
        f"当前值：{event.get('current_value')} {event.get('unit')}",
        f"阈值：{event.get('threshold_value')} {event.get('unit')}",
    ]
    if renewal.get("kind") == "contact_owner":
        lines.append("处理方式：联系群主")
        if renewal.get("instructions"):
            lines.append(str(renewal["instructions"]))
    elif renewal.get("kind") == "payment_link":
        lines.append(f"处理方式：{renewal.get('label', '打开充值页面')}")
        lines.append(str(renewal.get("url", "")))
    elif renewal.get("kind") == "manual":
        lines.append("处理方式：人工处理")
        if renewal.get("instructions"):
            lines.append(str(renewal["instructions"]))
    return {"text": "\n".join(line for line in lines if line)}

