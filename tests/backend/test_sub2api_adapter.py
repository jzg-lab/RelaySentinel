from __future__ import annotations

import importlib

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.anyio
async def test_sub2api_adapter_logs_in_and_reads_current_user_balance():
    adapter_module = importlib.import_module("relay_sentinel.adapters.sub2api")
    adapter = adapter_module.Sub2APIAdapter(
        base_url="https://sub2api.test",
        email="owner@example.com",
        password="secret-password",
    )

    async def app(scope, receive, send):
        assert scope["type"] == "http"
        request_path = scope["path"]

        if request_path == "/api/v1/auth/login":
            body = await _read_body(receive)
            assert b"owner@example.com" in body
            assert b"secret-password" in body
            await _send_json(
                send,
                {
                    "code": 0,
                    "message": "success",
                    "data": {
                        "access_token": "access-token",
                        "refresh_token": "refresh-token",
                        "expires_in": 3600,
                        "user": {"id": 7, "email": "owner@example.com"},
                    },
                },
            )
            return

        if request_path == "/api/v1/auth/me":
            auth_header = dict(scope["headers"]).get(b"authorization", b"").decode()
            assert auth_header == "Bearer access-token"
            await _send_json(
                send,
                {
                    "code": 0,
                    "message": "success",
                    "data": {
                        "id": 7,
                        "email": "owner@example.com",
                        "balance": 4.1,
                        "quota": 4.1,
                        "group": "default",
                    },
                },
            )
            return

        await _send_json(send, {"detail": "not found"}, status=404)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://sub2api.test") as http_client:
        signal = await adapter.fetch_balance(http_client=http_client)

    assert signal.target_kind == "upstream"
    assert signal.platform == "sub2api"
    assert signal.metric == "balance"
    assert signal.value == 4.1
    assert signal.unit == "USD"
    assert signal.confidence == "confirmed"


@pytest.mark.anyio
async def test_sub2api_adapter_reports_cloudflare_block_as_unsupported_login():
    adapter_module = importlib.import_module("relay_sentinel.adapters.sub2api")
    errors_module = importlib.import_module("relay_sentinel.adapters.errors")
    adapter = adapter_module.Sub2APIAdapter(
        base_url="https://sub2api.test",
        email="owner@example.com",
        password="secret-password",
    )

    async def app(scope, receive, send):
        await _send_json(
            send,
            {
                "type": "about:blank",
                "title": "Forbidden",
                "status": 403,
                "detail": "Cloudflare challenge required",
                "cloudflare_error": True,
            },
            status=403,
        )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://sub2api.test") as http_client:
        with pytest.raises(errors_module.AdapterAuthBlockedError) as exc_info:
            await adapter.fetch_balance(http_client=http_client)

    assert "Cloudflare" in str(exc_info.value)


@pytest.mark.anyio
async def test_sub2api_adapter_falls_back_to_quota_when_balance_is_missing():
    adapter_module = importlib.import_module("relay_sentinel.adapters.sub2api")
    adapter = adapter_module.Sub2APIAdapter(
        base_url="https://sub2api.test",
        email="owner@example.com",
        password="secret-password",
    )

    async def app(scope, receive, send):
        if scope["path"] == "/api/v1/auth/login":
            await _send_json(send, {"code": 0, "data": {"access_token": "access-token"}})
            return

        if scope["path"] == "/api/v1/auth/me":
            await _send_json(
                send,
                {
                    "code": 0,
                    "data": {
                        "id": 7,
                        "email": "owner@example.com",
                        "quota": 9.9,
                    },
                },
            )
            return

        await _send_json(send, {"detail": "not found"}, status=404)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://sub2api.test") as http_client:
        signal = await adapter.fetch_balance(http_client=http_client)

    assert signal.metric == "balance"
    assert signal.value == 9.9
    assert signal.confidence == "confirmed"


@pytest.mark.anyio
async def test_sub2api_adapter_distinguishes_invalid_credentials_from_cloudflare_block():
    adapter_module = importlib.import_module("relay_sentinel.adapters.sub2api")
    errors_module = importlib.import_module("relay_sentinel.adapters.errors")
    adapter = adapter_module.Sub2APIAdapter(
        base_url="https://sub2api.test",
        email="owner@example.com",
        password="wrong-password",
    )

    async def app(scope, receive, send):
        await _send_json(send, {"code": 401, "message": "invalid email or password"}, status=401)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://sub2api.test") as http_client:
        with pytest.raises(errors_module.AdapterAuthError) as exc_info:
            await adapter.fetch_balance(http_client=http_client)

    message = str(exc_info.value).lower()
    assert "password" in message or "credential" in message
    assert "cloudflare" not in message


@pytest.mark.anyio
async def test_sub2api_public_settings_detection_identifies_sub2api_like_site():
    adapter_module = importlib.import_module("relay_sentinel.adapters.sub2api")

    async def app(scope, receive, send):
        assert scope["path"] == "/api/v1/settings/public"
        await _send_json(
            send,
            {
                "code": 0,
                "data": {
                    "site_name": "Sub2API Demo",
                    "api_base": "/api/v1",
                    "local_storage_key": "sub2api_locale",
                },
            },
        )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://sub2api.test") as http_client:
        detection = await adapter_module.detect_sub2api_site(
            base_url="https://sub2api.test",
            http_client=http_client,
        )

    assert detection["is_sub2api_like"] is True
    assert detection["api_base"] == "/api/v1"


async def _read_body(receive) -> bytes:
    body = b""
    while True:
        message = await receive()
        if message["type"] != "http.request":
            continue
        body += message.get("body", b"")
        if not message.get("more_body"):
            return body


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
