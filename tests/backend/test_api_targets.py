from __future__ import annotations

from tests.backend.helpers import pool_payload, upstream_payload


def test_create_upstream_accepts_only_new_api_or_sub2api(client):
    response = client.post(
        "/api/upstreams",
        json={
            "name": "词元 fast",
            "platform": "sub2api",
            "base_url": "https://ciyuan.fast",
            "credential": {
                "kind": "login",
                "email": "owner@example.com",
                "password": "secret-password",
            },
            "threshold": {"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
            "check_interval_seconds": 1800,
            "renewal": {"kind": "payment_link", "label": "购买额度", "url": "https://ciyuan.fast/purchase"},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "upstream"
    assert body["platform"] == "sub2api"
    assert body["renewal"]["kind"] == "payment_link"
    assert "password" not in str(body).lower()

    rejected = client.post(
        "/api/upstreams",
        json={
            "name": "错误示例",
            "platform": "cliproxyapi",
            "base_url": "https://cpa.example.com",
            "credential": {"kind": "token", "token": "secret"},
            "threshold": {"metric": "balance", "operator": "lt", "value": 10, "unit": "USD"},
            "check_interval_seconds": 1800,
            "renewal": {"kind": "manual", "instructions": "联系群主"},
        },
    )

    assert rejected.status_code == 422
    assert "CLIProxyAPI" in rejected.text or "cliproxyapi" in rejected.text


def test_upstream_validation_rejects_invalid_url_threshold_and_renewal(client):
    invalid_url = client.post(
        "/api/upstreams",
        json=upstream_payload(base_url="not a url"),
    )
    invalid_threshold = client.post(
        "/api/upstreams",
        json=upstream_payload(threshold={"metric": "balance", "operator": "lt", "value": 0, "unit": "USD"}),
    )
    invalid_renewal = client.post(
        "/api/upstreams",
        json=upstream_payload(renewal={"kind": "auto_pay", "url": "https://pay.example.com"}),
    )

    assert invalid_url.status_code == 422
    assert invalid_threshold.status_code == 422
    assert invalid_renewal.status_code == 422


def test_create_upstream_uses_safe_defaults_when_intervals_are_omitted(client):
    response = client.post("/api/upstreams", json=upstream_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["check_interval_seconds"] == 1800
    assert body["status"] in {"pending_probe", "active"}


def test_upstream_crud_never_exposes_credentials(client):
    created = client.post("/api/upstreams", json=upstream_payload()).json()
    upstream_id = created["id"]

    listed = client.get("/api/upstreams")
    detail = client.get(f"/api/upstreams/{upstream_id}")
    patched = client.patch(
        f"/api/upstreams/{upstream_id}",
        json={
            "name": "词元 fast 备用",
            "threshold": {"metric": "balance", "operator": "lt", "value": 20, "unit": "USD"},
            "credential": {"kind": "login", "email": "new@example.com", "password": "new-secret-password"},
        },
    )

    assert listed.status_code == 200
    assert detail.status_code == 200
    assert patched.status_code == 200
    assert patched.json()["name"] == "词元 fast 备用"
    assert patched.json()["threshold"]["value"] == 20

    combined = f"{listed.text}\n{detail.text}\n{patched.text}"
    assert "secret-password" not in combined
    assert "new-secret-password" not in combined
    assert "token" not in str(created.get("credential", {})).lower()

    deleted = client.delete(f"/api/upstreams/{upstream_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/upstreams/{upstream_id}").status_code == 404


def test_create_pool_is_owned_resource_and_can_reference_advanced_quota_source(client):
    response = client.post(
        "/api/pools",
        json={
            "name": "自营 Sub2API 号池",
            "platform": "sub2api",
            "base_url": "https://self.example.com",
            "credential": {"kind": "admin_token", "token": "secret-admin-token"},
            "health_check_interval_seconds": 600,
            "quota_check_interval_seconds": 5400,
            "quota_alert_threshold_hours": 5,
        },
    )

    assert response.status_code == 201
    pool = response.json()
    assert pool["kind"] == "pool"
    assert pool["platform"] == "sub2api"
    assert pool["ownership"] == "owned"
    assert "secret-admin-token" not in str(pool)

    source = client.post(
        f"/api/pools/{pool['id']}/quota-sources",
        json={
            "kind": "cliproxyapi",
            "base_url": "https://cpa.example.com",
            "credential": {"kind": "token", "token": "secret-cpa-token"},
        },
    )

    assert source.status_code == 201
    source_body = source.json()
    assert source_body["kind"] == "cliproxyapi"
    assert source_body["pool_id"] == pool["id"]
    assert source_body["status"] in {"pending_probe", "available", "unavailable"}
    assert "secret-cpa-token" not in str(source_body)


def test_pool_validation_rejects_external_only_or_invalid_inputs(client):
    cpa_as_pool = client.post(
        "/api/pools",
        json=pool_payload(platform="cliproxyapi", base_url="https://cpa.example.com"),
    )
    invalid_url = client.post("/api/pools", json=pool_payload(base_url="self.example.com"))
    invalid_threshold = client.post("/api/pools", json=pool_payload(quota_alert_threshold_hours=0))

    assert cpa_as_pool.status_code == 422
    assert invalid_url.status_code == 422
    assert invalid_threshold.status_code == 422


def test_create_pool_uses_separate_health_and_quota_check_defaults(client):
    response = client.post("/api/pools", json=pool_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["health_check_interval_seconds"] == 600
    assert body["quota_check_interval_seconds"] == 5400
    assert body["quota_alert_threshold_hours"] == 5
    assert body["status"] in {"pending_probe", "active"}


def test_pool_crud_never_exposes_credentials_and_removes_from_mobile_home(client):
    created = client.post("/api/pools", json=pool_payload()).json()
    pool_id = created["id"]

    listed = client.get("/api/pools")
    detail = client.get(f"/api/pools/{pool_id}")
    patched = client.patch(
        f"/api/pools/{pool_id}",
        json={
            "name": "自营 New API 号池",
            "platform": "new_api",
            "credential": {"kind": "admin_token", "token": "rotated-pool-secret"},
            "quota_alert_threshold_hours": 7,
        },
    )

    assert listed.status_code == 200
    assert detail.status_code == 200
    assert patched.status_code == 200
    assert patched.json()["name"] == "自营 New API 号池"
    assert patched.json()["quota_alert_threshold_hours"] == 7

    combined = f"{listed.text}\n{detail.text}\n{patched.text}"
    assert "secret-admin-token" not in combined
    assert "rotated-pool-secret" not in combined

    deleted = client.delete(f"/api/pools/{pool_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/pools/{pool_id}").status_code == 404
    assert all(pool["id"] != pool_id for pool in client.get("/api/mobile/home").json()["pools"])


def test_dashboard_keeps_upstream_and_pool_sections_separate(client):
    client.post(
        "/api/upstreams",
        json={
            "name": "外部 New API",
            "platform": "new_api",
            "base_url": "https://upstream.example.com",
            "credential": {"kind": "token", "token": "upstream-secret"},
            "threshold": {"metric": "balance", "operator": "lt", "value": 50, "unit": "CNY"},
            "check_interval_seconds": 1800,
            "renewal": {"kind": "contact_owner", "instructions": "群内 @owner"},
        },
    )
    client.post(
        "/api/pools",
        json={
            "name": "自己的 New API",
            "platform": "new_api",
            "base_url": "https://owned.example.com",
            "credential": {"kind": "admin_token", "token": "owned-secret"},
            "health_check_interval_seconds": 600,
            "quota_check_interval_seconds": 5400,
            "quota_alert_threshold_hours": 5,
        },
    )

    response = client.get("/api/mobile/home")

    assert response.status_code == 200
    body = response.json()
    assert "upstreams" in body
    assert "pools" in body
    assert body["upstreams"][0]["kind"] == "upstream"
    assert body["pools"][0]["kind"] == "pool"
    assert body.get("default_business_view") == "upstreams"
