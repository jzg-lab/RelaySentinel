from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from relay_sentinel.adapters.errors import AdapterAuthBlockedError, AdapterAuthError
from relay_sentinel.adapters.signals import BalanceSignal


class NewAPIAdapter:
    def __init__(self, *, base_url: str, admin_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.admin_token = admin_token

    async def _fetch_channels(self, *, http_client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
        owns_client = http_client is None
        client = http_client or httpx.AsyncClient(base_url=self.base_url)
        try:
            response = await client.get("/api/channel/", headers={"Authorization": f"Bearer {self.admin_token}"})
            payload = _json_or_text(response)
            _raise_for_auth_problem(response.status_code, payload)
            return payload.get("data") or []
        finally:
            if owns_client:
                await client.aclose()

    async def fetch_balance(self, *, http_client: httpx.AsyncClient | None = None) -> BalanceSignal:
        channels = await self._fetch_channels(http_client=http_client)
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

    async def fetch_account_health(self, *, http_client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """Return per-channel health status for pool health checks."""
        channels = await self._fetch_channels(http_client=http_client)
        accounts = []
        for channel in channels:
            ch_id = str(channel.get("id", ""))
            ch_name = channel.get("name", ch_id)
            ch_status = channel.get("status")
            accounts.append({
                "id": ch_id,
                "name": ch_name,
                "status": "ok" if ch_status == 1 else "failed",
            })
        return {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "accounts": accounts,
        }

    async def fetch_quota(self, *, http_client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """Return quota snapshot for pool quota prediction.

        Derives a synthetic remaining-percent from (balance / (balance + used_quota))
        for every NewAPI channel. Both five_hour and seven_day buckets use the same
        percentage since NewAPI does not distinguish granularity buckets natively;
        burn-rate is computed by the domain layer from sequential snapshots.
        """
        channels = await self._fetch_channels(http_client=http_client)
        total_balance = 0.0
        total_used = 0.0
        for ch in channels:
            total_balance += float(ch.get("balance") or 0)
            total_used += float(ch.get("used_quota") or 0)
        total_capacity = total_balance + total_used
        remaining_pct = round((total_balance / total_capacity * 100) if total_capacity > 0 else 100.0, 2)
        return {
            "current": {
                "checked_at": datetime.now(timezone.utc),
                "five_hour_remaining_percent": remaining_pct,
                "seven_day_remaining_percent": remaining_pct,
                "total_balance": round(total_balance, 4),
                "total_used": round(total_used, 4),
                "channel_count": len(channels),
            },
            "history": [],
        }


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

