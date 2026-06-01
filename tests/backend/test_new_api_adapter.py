from __future__ import annotations

import importlib

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.anyio
async def test_new_api_adapter_reads_admin_channel_balance_list_and_normalizes_signal():
    adapter_module = importlib.import_module("relay_sentinel.adapters.new_api")
    adapter = adapter_module.NewAPIAdapter(
        base_url="https://new-api.test",
        admin_token="secret-admin-token",
    )

    async def app(scope, receive, send):
        assert scope["type"] == "http"
        if scope["path"] == "/api/channel/":
            auth_header = dict(scope["headers"]).get(b"authorization", b"").decode()
            assert auth_header == "Bearer secret-admin-token"
            await _send_json(
                send,
                {
                    "success": True,
                    "data": [
                        {"id": 1, "name": "gpt-4.1", "status": 1, "balance": 12.5, "used_quota": 87.5},
                        {"id": 2, "name": "claude", "status": 1, "balance": 7.0, "used_quota": 93.0},
                    ],
                },
            )
            return

        await _send_json(send, {"message": "not found"}, status=404)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://new-api.test") as http_client:
        signal = await adapter.fetch_balance(http_client=http_client)

    assert signal.target_kind == "upstream"
    assert signal.platform == "new_api"
    assert signal.metric == "balance"
    assert signal.value == 19.5
    assert signal.unit == "USD"
    assert signal.confidence == "confirmed"
    assert signal.raw["channel_count"] == 2


@pytest.mark.anyio
async def test_new_api_adapter_distinguishes_invalid_admin_token_from_blocked_site():
    adapter_module = importlib.import_module("relay_sentinel.adapters.new_api")
    errors_module = importlib.import_module("relay_sentinel.adapters.errors")
    adapter = adapter_module.NewAPIAdapter(
        base_url="https://new-api.test",
        admin_token="wrong-token",
    )

    async def app(scope, receive, send):
        await _send_json(send, {"success": False, "message": "invalid token"}, status=401)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://new-api.test") as http_client:
        with pytest.raises(errors_module.AdapterAuthError) as exc_info:
            await adapter.fetch_balance(http_client=http_client)

    assert "token" in str(exc_info.value).lower()
    assert "cloudflare" not in str(exc_info.value).lower()


@pytest.mark.anyio
async def test_new_api_adapter_reports_cloudflare_block_separately():
    adapter_module = importlib.import_module("relay_sentinel.adapters.new_api")
    errors_module = importlib.import_module("relay_sentinel.adapters.errors")
    adapter = adapter_module.NewAPIAdapter(
        base_url="https://new-api.test",
        admin_token="secret-admin-token",
    )

    async def app(scope, receive, send):
        await _send_json(
            send,
            {"title": "Forbidden", "detail": "Cloudflare challenge required"},
            status=403,
        )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://new-api.test") as http_client:
        with pytest.raises(errors_module.AdapterAuthBlockedError):
            await adapter.fetch_balance(http_client=http_client)


async def _send_json(send, payload: dict, status: int = 200) -> None:
    import json

    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})
