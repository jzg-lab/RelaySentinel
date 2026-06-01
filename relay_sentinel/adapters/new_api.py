from __future__ import annotations

from typing import Any

import httpx

from relay_sentinel.adapters.errors import AdapterAuthBlockedError, AdapterAuthError
from relay_sentinel.adapters.signals import BalanceSignal


class NewAPIAdapter:
    def __init__(self, *, base_url: str, admin_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.admin_token = admin_token

    async def fetch_balance(self, *, http_client: httpx.AsyncClient | None = None) -> BalanceSignal:
        owns_client = http_client is None
        client = http_client or httpx.AsyncClient(base_url=self.base_url)
        try:
            response = await client.get("/api/channel/", headers={"Authorization": f"Bearer {self.admin_token}"})
            payload = _json_or_text(response)
            _raise_for_auth_problem(response.status_code, payload)
            channels = payload.get("data") or []
            balance = sum(float(channel.get("balance") or 0) for channel in channels)
            return BalanceSignal(
                target_kind="upstream",
                platform="new_api",
                metric="balance",
                value=balance,
                unit="USD",
                confidence="confirmed",
                raw={"channel_count": len(channels)},
            )
        finally:
            if owns_client:
                await client.aclose()


def _raise_for_auth_problem(status_code: int, payload: dict[str, Any]) -> None:
    text = str(payload)
    lowered = text.lower()
    if status_code == 403 or "cloudflare" in lowered or "challenge" in lowered:
        raise AdapterAuthBlockedError("Cloudflare challenge required")
    if status_code in {400, 401} or "invalid token" in lowered:
        raise AdapterAuthError(payload.get("message") or "token rejected")


def _json_or_text(response: httpx.Response) -> dict[str, Any]:
    try:
        return response.json()
    except ValueError:
        return {"text": response.text}

