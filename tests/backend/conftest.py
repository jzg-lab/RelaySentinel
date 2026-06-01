from __future__ import annotations

import importlib
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient


def load_create_app():
    try:
        module = importlib.import_module("relay_sentinel.app")
    except ModuleNotFoundError as exc:
        pytest.fail(
            "Backend package is missing. Implement relay_sentinel.app:create_app(settings: dict | None = None).",
            pytrace=False,
        )
        raise exc

    create_app = getattr(module, "create_app", None)
    if create_app is None:
        pytest.fail("relay_sentinel.app must expose create_app(settings: dict | None = None).", pytrace=False)

    return create_app


@pytest.fixture()
def client(tmp_path) -> Generator[TestClient, None, None]:
    create_app = load_create_app()
    app = create_app(
        settings={
            "database_url": f"sqlite:///{tmp_path / 'relay_sentinel_test.db'}",
            "secret_key": "test-secret-key",
            "disable_scheduler": True,
            "notification_dry_run": True,
        }
    )

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"
