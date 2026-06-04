from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from relay_sentinel.adapters.errors import AdapterAuthBlockedError, AdapterAuthError
from relay_sentinel.adapters.signals import BalanceSignal


class Sub2APIAdapter:
    def __init__(self, *, base_url: str, email: str, password: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password

    async def _login_and_get_me(self, *, http_client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """Login and return the /auth/me user data dict."""
        owns_client = http_client is None
        client = http_client or httpx.AsyncClient(base_url=self.base_url)
        try:
            login = await client.post(
                "/api/v1/auth/login",
                json={"email": self.email, "password": self.password},
            )
            payload = _json_or_text(login)
            _raise_for_auth_problem(login.status_code, payload)
            access_token = (payload.get("data") or {}).get("access_token")
            if not access_token:
                raise AdapterAuthError("credential login did not return an access token")
            me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
            me_payload = _json_or_text(me)
            _raise_for_auth_problem(me.status_code, me_payload)
            return me_payload.get("data") or {}
        finally:
            if owns_client:
                await client.aclose()

    async def fetch_balance(self, *, http_client: httpx.AsyncClient | None = None) -> BalanceSignal:
        data = await self._login_and_get_me(http_client=http_client)
        value = data.get("balance", data.get("quota"))
        if value is None:
            raise AdapterAuthError("credential accepted but balance signal is missing")
        return BalanceSignal(
            target_kind="upstream",
            platform="sub2api",
            metric="balance",
            value=float(value),
            unit="USD",
            confidence="confirmed",
            raw={"user_id": data.get("id")},
        )

    async def fetch_account_health(self, *, http_client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """Return single-account health by verifying login and /me access."""
        data = await self._login_and_get_me(http_client=http_client)
        user_id = str(data.get("id", "me"))
        return {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "accounts": [
                {
                    "id": user_id,
                    "name": data.get("email", user_id),
                    "status": "ok",
                }
            ],
        }

    async def fetch_quota(self, *, http_client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """Return quota snapshot for pool quota prediction.

        Sub2API only exposes a single balance / quota value per user account.
        We use that value as both five_hour and seven_day remaining percentages
        (normalised against the first observed value by the app layer).
        """
        data = await self._login_and_get_me(http_client=http_client)
        balance = float(data.get("balance", data.get("quota", 0)))
        return {
            "current": {
                "checked_at": datetime.now(timezone.utc),
                "balance": balance,
                "user_id": data.get("id"),
            },
            "history": [],
        }


async def detect_sub2api_site(
    *,
    base_url: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(base_url=base_url.rstrip("/"))
    try:
        response = await client.get("/api/v1/settings/public")
        payload = _json_or_text(response)
        data = payload.get("data") or {}
        joined = " ".join(str(value).lower() for value in data.values())
        is_like = response.status_code == 200 and ("sub2api" in joined or data.get("api_base") == "/api/v1")
        return {"is_sub2api_like": is_like, "api_base": data.get("api_base")}
    finally:
        if owns_client:
            await client.aclose()


def _raise_for_auth_problem(status_code: int, payload: dict[str, Any]) -> None:
    text = str(payload)
    lowered = text.lower()
    if status_code == 403 or "cloudflare" in lowered or "challenge" in lowered:
        raise AdapterAuthBlockedError("Cloudflare challenge required")
    if status_code in {400, 401, 403} or payload.get("code") in {400, 401, 403}:
        raise AdapterAuthError(payload.get("message") or "credential rejected")
    if "invalid" in lowered and ("password" in lowered or "credential" in lowered or "email" in lowered):
        raise AdapterAuthError(payload.get("message") or "credential rejected")


def _json_or_text(response: httpx.Response) -> dict[str, Any]:
    try:
        return response.json()
    except ValueError:
        return {"text": response.text}

