from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, *, database_url: str, secret_key: str) -> None:
        self.database_path = _sqlite_path(database_url)
        self.secret_key = secret_key
        if self.database_path != ":memory:":
            Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def create_upstream(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = {
            "id": _new_id("up"),
            "kind": "upstream",
            "name": payload["name"],
            "platform": payload["platform"],
            "base_url": payload["base_url"],
            "threshold": payload["threshold"],
            "check_interval_seconds": payload.get("check_interval_seconds", 1800),
            "renewal": payload["renewal"],
            "status": "pending_probe",
            "last_balance_checked_at": None,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        with self._connect() as connection:
            connection.execute(
                """
                insert into upstreams (
                    id, name, platform, base_url, threshold_json, check_interval_seconds,
                    renewal_json, status, last_balance_checked_at, credential_blob,
                    created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["name"],
                    item["platform"],
                    item["base_url"],
                    _dumps(item["threshold"]),
                    item["check_interval_seconds"],
                    _dumps(item["renewal"]),
                    item["status"],
                    item["last_balance_checked_at"],
                    self.seal(payload.get("credential") or {}),
                    item["created_at"],
                    item["updated_at"],
                ),
            )
        return item

    def list_upstreams(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("select * from upstreams order by created_at").fetchall()
        return [_upstream_from_row(row) for row in rows]

    def get_upstream(self, item_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("select * from upstreams where id = ?", (item_id,)).fetchone()
        return _upstream_from_row(row) if row else None

    def update_upstream(self, item_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_upstream(item_id)
        if current is None:
            return None
        merged = {**current, **{key: value for key, value in patch.items() if key != "credential"}}
        merged["updated_at"] = utc_now_iso()
        with self._connect() as connection:
            connection.execute(
                """
                update upstreams
                set name = ?, platform = ?, base_url = ?, threshold_json = ?,
                    check_interval_seconds = ?, renewal_json = ?, status = ?,
                    updated_at = ?
                where id = ?
                """,
                (
                    merged["name"],
                    merged["platform"],
                    merged["base_url"],
                    _dumps(merged["threshold"]),
                    merged["check_interval_seconds"],
                    _dumps(merged["renewal"]),
                    merged["status"],
                    merged["updated_at"],
                    item_id,
                ),
            )
            if "credential" in patch:
                connection.execute(
                    "update upstreams set credential_blob = ? where id = ?",
                    (self.seal(patch["credential"]), item_id),
                )
        return self.get_upstream(item_id)

    def delete_upstream(self, item_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("delete from upstreams where id = ?", (item_id,))
        return cursor.rowcount > 0

    def create_pool(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = {
            "id": _new_id("pool"),
            "kind": "pool",
            "ownership": "owned",
            "name": payload["name"],
            "platform": payload["platform"],
            "base_url": payload["base_url"],
            "health_check_interval_seconds": payload.get("health_check_interval_seconds", 600),
            "quota_check_interval_seconds": payload.get("quota_check_interval_seconds", 5400),
            "quota_alert_threshold_hours": payload["quota_alert_threshold_hours"],
            "status": "pending_probe",
            "last_health_checked_at": None,
            "last_quota_checked_at": None,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        with self._connect() as connection:
            connection.execute(
                """
                insert into pools (
                    id, name, platform, base_url, health_check_interval_seconds,
                    quota_check_interval_seconds, quota_alert_threshold_hours, status,
                    last_health_checked_at, last_quota_checked_at, credential_blob,
                    created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["name"],
                    item["platform"],
                    item["base_url"],
                    item["health_check_interval_seconds"],
                    item["quota_check_interval_seconds"],
                    item["quota_alert_threshold_hours"],
                    item["status"],
                    item["last_health_checked_at"],
                    item["last_quota_checked_at"],
                    self.seal(payload.get("credential") or {}),
                    item["created_at"],
                    item["updated_at"],
                ),
            )
        return item

    def list_pools(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("select * from pools order by created_at").fetchall()
        return [_pool_from_row(row) for row in rows]

    def get_pool(self, item_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("select * from pools where id = ?", (item_id,)).fetchone()
        return _pool_from_row(row) if row else None

    def update_pool(self, item_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_pool(item_id)
        if current is None:
            return None
        merged = {**current, **{key: value for key, value in patch.items() if key != "credential"}}
        merged["updated_at"] = utc_now_iso()
        with self._connect() as connection:
            connection.execute(
                """
                update pools
                set name = ?, platform = ?, base_url = ?, health_check_interval_seconds = ?,
                    quota_check_interval_seconds = ?, quota_alert_threshold_hours = ?,
                    status = ?, updated_at = ?
                where id = ?
                """,
                (
                    merged["name"],
                    merged["platform"],
                    merged["base_url"],
                    merged["health_check_interval_seconds"],
                    merged["quota_check_interval_seconds"],
                    merged["quota_alert_threshold_hours"],
                    merged["status"],
                    merged["updated_at"],
                    item_id,
                ),
            )
            if "credential" in patch:
                connection.execute(
                    "update pools set credential_blob = ? where id = ?",
                    (self.seal(patch["credential"]), item_id),
                )
        return self.get_pool(item_id)

    def delete_pool(self, item_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("delete from pools where id = ?", (item_id,))
        return cursor.rowcount > 0

    def create_quota_source(self, pool_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        item = {
            "id": _new_id("qsrc"),
            "pool_id": pool_id,
            "kind": payload["kind"],
            "base_url": payload["base_url"],
            "status": "pending_probe",
            "created_at": utc_now_iso(),
        }
        with self._connect() as connection:
            connection.execute(
                """
                insert into quota_sources (id, pool_id, kind, base_url, status, credential_blob, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["pool_id"],
                    item["kind"],
                    item["base_url"],
                    item["status"],
                    self.seal(payload.get("credential") or {}),
                    item["created_at"],
                ),
            )
        return item

    def create_notification_channel(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = {
            "id": _new_id("chan"),
            "name": payload["name"],
            "kind": payload["kind"],
            "enabled": bool(payload.get("enabled", True)),
            "template": payload.get("template", "default"),
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        with self._connect() as connection:
            connection.execute(
                """
                insert into notification_channels (
                    id, name, kind, enabled, url_blob, template, created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["name"],
                    item["kind"],
                    int(item["enabled"]),
                    self.seal({"url": payload["url"]}),
                    item["template"],
                    item["created_at"],
                    item["updated_at"],
                ),
            )
        return item

    def list_notification_channels(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("select * from notification_channels order by created_at").fetchall()
        return [_channel_from_row(row) for row in rows]

    def get_notification_channel(self, item_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("select * from notification_channels where id = ?", (item_id,)).fetchone()
        return _channel_from_row(row) if row else None

    def get_notification_channel_secret(self, item_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("select url_blob from notification_channels where id = ?", (item_id,)).fetchone()
        return self.open(row["url_blob"]) if row else None

    def update_notification_channel(self, item_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_notification_channel(item_id)
        if current is None:
            return None
        merged = {**current, **patch}
        merged["updated_at"] = utc_now_iso()
        with self._connect() as connection:
            connection.execute(
                """
                update notification_channels
                set name = ?, kind = ?, enabled = ?, template = ?, updated_at = ?
                where id = ?
                """,
                (
                    merged["name"],
                    merged["kind"],
                    int(bool(merged["enabled"])),
                    merged.get("template", "default"),
                    merged["updated_at"],
                    item_id,
                ),
            )
            if "url" in patch:
                connection.execute(
                    "update notification_channels set url_blob = ? where id = ?",
                    (self.seal({"url": patch["url"]}), item_id),
                )
        return self.get_notification_channel(item_id)

    def create_alert_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = {
            "id": payload.get("id") or _new_id("alert"),
            "target_id": payload["target_id"],
            "target_kind": payload.get("target_kind", "upstream"),
            "rule_id": payload["rule_id"],
            "severity": payload.get("severity", "warning"),
            "title": payload.get("title", "告警"),
            "message": payload.get("message", ""),
            "status": payload.get("status", "open"),
            "action": payload.get("action"),
            "created_at": payload.get("created_at") or utc_now_iso(),
            "snoozed_until": payload.get("snoozed_until"),
            "resolved_at": payload.get("resolved_at"),
        }
        with self._connect() as connection:
            connection.execute(
                """
                insert into alert_events (
                    id, target_id, target_kind, rule_id, severity, title, message, status,
                    action, created_at, snoozed_until, resolved_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["target_id"],
                    item["target_kind"],
                    item["rule_id"],
                    item["severity"],
                    item["title"],
                    item["message"],
                    item["status"],
                    item["action"],
                    item["created_at"],
                    item["snoozed_until"],
                    item["resolved_at"],
                ),
            )
        return item

    def list_alert_events(
        self,
        *,
        target_id: str | None = None,
        status: str | None = None,
        since: str | None = None,
    ) -> list[dict[str, Any]]:
        query = "select * from alert_events where 1 = 1"
        params: list[Any] = []
        if target_id:
            query += " and target_id = ?"
            params.append(target_id)
        if status:
            query += " and status = ?"
            params.append(status)
        if since:
            query += " and created_at >= ?"
            params.append(since.replace("Z", "+00:00"))
        query += " order by created_at desc"
        with self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [_event_from_row(row) for row in rows]

    def get_alert_event(self, item_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("select * from alert_events where id = ?", (item_id,)).fetchone()
        return _event_from_row(row) if row else None

    def update_alert_status(
        self,
        item_id: str,
        *,
        status: str,
        action: str,
        note: str | None = None,
        until: str | None = None,
    ) -> dict[str, Any] | None:
        current = self.get_alert_event(item_id)
        if current is None:
            return None
        with self._connect() as connection:
            connection.execute(
                "update alert_events set status = ?, snoozed_until = ?, resolved_at = ? where id = ?",
                (
                    status,
                    until if status == "snoozed" else current.get("snoozed_until"),
                    utc_now_iso() if status == "resolved" else current.get("resolved_at"),
                    item_id,
                ),
            )
            connection.execute(
                """
                insert into alert_actions (id, event_id, action, note, created_at)
                values (?, ?, ?, ?, ?)
                """,
                (_new_id("act"), item_id, action, note or until, utc_now_iso()),
            )
        return self.get_alert_event(item_id)

    def list_alert_actions(self, event_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "select * from alert_actions where event_id = ? order by rowid",
                (event_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def seal(self, payload: dict[str, Any]) -> str:
        raw = _dumps(_encode_secret_keys(payload)).encode("utf-8")
        stream = _secret_stream(self.secret_key, len(raw))
        sealed = bytes(byte ^ stream[index] for index, byte in enumerate(raw))
        return base64.urlsafe_b64encode(sealed).decode("ascii")

    def open(self, blob: str) -> dict[str, Any]:
        sealed = base64.urlsafe_b64decode(blob.encode("ascii"))
        stream = _secret_stream(self.secret_key, len(sealed))
        raw = bytes(byte ^ stream[index] for index, byte in enumerate(sealed))
        return _decode_secret_keys(json.loads(raw.decode("utf-8")))

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                create table if not exists upstreams (
                    id text primary key,
                    name text not null,
                    platform text not null,
                    base_url text not null,
                    threshold_json text not null,
                    check_interval_seconds integer not null,
                    renewal_json text not null,
                    status text not null,
                    last_balance_checked_at text,
                    credential_blob text not null,
                    created_at text not null,
                    updated_at text not null
                );

                create table if not exists pools (
                    id text primary key,
                    name text not null,
                    platform text not null,
                    base_url text not null,
                    health_check_interval_seconds integer not null,
                    quota_check_interval_seconds integer not null,
                    quota_alert_threshold_hours real not null,
                    status text not null,
                    last_health_checked_at text,
                    last_quota_checked_at text,
                    credential_blob text not null,
                    created_at text not null,
                    updated_at text not null
                );

                create table if not exists quota_sources (
                    id text primary key,
                    pool_id text not null,
                    kind text not null,
                    base_url text not null,
                    status text not null,
                    credential_blob text not null,
                    created_at text not null
                );

                create table if not exists notification_channels (
                    id text primary key,
                    name text not null,
                    kind text not null,
                    enabled integer not null,
                    url_blob text not null,
                    template text not null,
                    created_at text not null,
                    updated_at text not null
                );

                create table if not exists alert_events (
                    id text primary key,
                    target_id text not null,
                    target_kind text not null,
                    rule_id text not null,
                    severity text not null,
                    title text not null,
                    message text not null,
                    status text not null,
                    action text,
                    created_at text not null,
                    snoozed_until text,
                    resolved_at text
                );

                create table if not exists alert_actions (
                    id text primary key,
                    event_id text not null,
                    action text not null,
                    note text,
                    created_at text not null
                );
                """
            )


def _sqlite_path(database_url: str) -> str:
    if database_url == "sqlite:///:memory:":
        return ":memory:"
    prefix = "sqlite:///"
    if database_url.startswith(prefix):
        return database_url[len(prefix) - 1 :]
    return database_url


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _secret_stream(secret_key: str, length: int) -> bytes:
    seed = secret_key.encode("utf-8")
    output = b""
    counter = 0
    while len(output) < length:
        output += hashlib.sha256(seed + str(counter).encode("ascii")).digest()
        counter += 1
    return output[:length]


def _encode_secret_keys(value: Any) -> Any:
    if isinstance(value, dict):
        encoded = {}
        for key, item in value.items():
            safe_key = {"password": "p", "token": "t"}.get(key, key)
            encoded[safe_key] = _encode_secret_keys(item)
        return encoded
    if isinstance(value, list):
        return [_encode_secret_keys(item) for item in value]
    return value


def _decode_secret_keys(value: Any) -> Any:
    if isinstance(value, dict):
        decoded = {}
        for key, item in value.items():
            real_key = {"p": "password", "t": "token"}.get(key, key)
            decoded[real_key] = _decode_secret_keys(item)
        return decoded
    if isinstance(value, list):
        return [_decode_secret_keys(item) for item in value]
    return value


def _upstream_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": "upstream",
        "name": row["name"],
        "platform": row["platform"],
        "base_url": row["base_url"],
        "threshold": json.loads(row["threshold_json"]),
        "check_interval_seconds": row["check_interval_seconds"],
        "renewal": json.loads(row["renewal_json"]),
        "status": row["status"],
        "last_balance_checked_at": row["last_balance_checked_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _pool_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": "pool",
        "ownership": "owned",
        "name": row["name"],
        "platform": row["platform"],
        "base_url": row["base_url"],
        "health_check_interval_seconds": row["health_check_interval_seconds"],
        "quota_check_interval_seconds": row["quota_check_interval_seconds"],
        "quota_alert_threshold_hours": row["quota_alert_threshold_hours"],
        "status": row["status"],
        "last_health_checked_at": row["last_health_checked_at"],
        "last_quota_checked_at": row["last_quota_checked_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _channel_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "enabled": bool(row["enabled"]),
        "template": row["template"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _event_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "target_id": row["target_id"],
        "target_kind": row["target_kind"],
        "rule_id": row["rule_id"],
        "severity": row["severity"],
        "title": row["title"],
        "message": row["message"],
        "status": row["status"],
        "action": row["action"],
        "created_at": row["created_at"],
        "snoozed_until": row["snoozed_until"],
        "resolved_at": row["resolved_at"],
    }

