from __future__ import annotations

import importlib
import sqlite3

from fastapi.testclient import TestClient

from tests.backend.helpers import pool_payload, upstream_payload


def test_sqlite_persistence_retains_targets_across_app_instances(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")
    database_path = tmp_path / "relay_sentinel.db"
    settings = {
        "database_url": f"sqlite:///{database_path}",
        "secret_key": "test-secret-key",
        "disable_scheduler": True,
        "notification_dry_run": True,
    }

    with TestClient(app_module.create_app(settings=settings)) as client:
        created = client.post("/api/upstreams", json=upstream_payload()).json()

    with TestClient(app_module.create_app(settings=settings)) as client:
        response = client.get(f"/api/upstreams/{created['id']}")

    assert response.status_code == 200
    assert response.json()["name"] == "词元 fast"


def test_credentials_are_not_stored_as_raw_json_or_plain_text(tmp_path):
    app_module = importlib.import_module("relay_sentinel.app")
    database_path = tmp_path / "relay_sentinel.db"
    settings = {
        "database_url": f"sqlite:///{database_path}",
        "secret_key": "test-secret-key",
        "disable_scheduler": True,
        "notification_dry_run": True,
    }

    with TestClient(app_module.create_app(settings=settings)) as client:
        client.post("/api/upstreams", json=upstream_payload())
        client.post("/api/pools", json=pool_payload())

    database_bytes = database_path.read_bytes()
    assert b"secret-password" not in database_bytes
    assert b"secret-admin-token" not in database_bytes
    assert b'"password"' not in database_bytes
    assert b'"token"' not in database_bytes

    with sqlite3.connect(database_path) as connection:
        table_names = {
            row[0]
            for row in connection.execute("select name from sqlite_master where type = 'table'").fetchall()
        }

    assert "upstreams" in table_names
    assert "pools" in table_names


def test_api_errors_do_not_echo_submitted_secrets(client):
    response = client.post(
        "/api/upstreams",
        json=upstream_payload(
            base_url="not-a-url",
            credential={"kind": "login", "email": "owner@example.com", "password": "do-not-echo-this"},
        ),
    )

    assert response.status_code == 422
    assert "do-not-echo-this" not in response.text


def test_v1_does_not_expose_automatic_payment_or_balance_mutation_endpoints(client):
    upstream = client.post("/api/upstreams", json=upstream_payload()).json()
    pool = client.post("/api/pools", json=pool_payload()).json()

    forbidden_routes = [
        f"/api/upstreams/{upstream['id']}/pay",
        f"/api/upstreams/{upstream['id']}/renew",
        f"/api/upstreams/{upstream['id']}/recharge",
        f"/api/upstreams/{upstream['id']}/modify-balance",
        f"/api/pools/{pool['id']}/recharge",
        f"/api/pools/{pool['id']}/modify-balance",
    ]

    for route in forbidden_routes:
        response = client.post(route, json={"amount": 100})
        assert response.status_code == 404
