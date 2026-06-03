from __future__ import annotations

import importlib

import pytest


def test_asgi_rejects_default_secret_key_in_production_env(monkeypatch):
    monkeypatch.delenv("RELAY_SENTINEL_SECRET_KEY", raising=False)
    monkeypatch.delenv("RELAY_SENTINEL_ALLOW_INSECURE_DEFAULTS", raising=False)

    with pytest.raises(RuntimeError, match="RELAY_SENTINEL_SECRET_KEY"):
        importlib.reload(importlib.import_module("relay_sentinel.asgi"))


def test_asgi_allows_explicit_development_defaults(monkeypatch):
    monkeypatch.delenv("RELAY_SENTINEL_SECRET_KEY", raising=False)
    monkeypatch.setenv("RELAY_SENTINEL_ALLOW_INSECURE_DEFAULTS", "true")

    module = importlib.reload(importlib.import_module("relay_sentinel.asgi"))

    assert module.app.title == "RelaySentinel"
