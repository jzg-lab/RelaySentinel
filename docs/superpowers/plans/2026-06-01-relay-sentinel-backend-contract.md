# RelaySentinel Backend Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the FastAPI backend required by `docs/backend-implementation-contract.md` and prove it with `pytest tests/backend` plus the existing frontend tests.

**Architecture:** Build a small `relay_sentinel/` package with a FastAPI app, SQLite-backed repositories, pure domain functions, adapter modules, and webhook rendering. Keep the V1 boundary strict: upstreams are external New API/Sub2API services, owned pools are internal resources, and CLIProxyAPI/CPA only attach as quota sources.

**Tech Stack:** Python, FastAPI, SQLite, httpx, pytest; existing React/Vite frontend remains unchanged unless tests reveal a contract mismatch.

---

## Assumptions And Constraints

- Do not rewrite tests to fit implementation. If a test conflicts with `docs/backend-implementation-contract.md`, pause and surface the contradiction.
- Current worktree has many pre-existing uncommitted changes. Preserve them and keep backend edits scoped.
- Public imports required by tests must exist exactly:
  - `relay_sentinel.app.create_app`
  - `relay_sentinel.adapters.sub2api.Sub2APIAdapter`
  - `relay_sentinel.adapters.sub2api.detect_sub2api_site`
  - `relay_sentinel.adapters.new_api.NewAPIAdapter`
  - `relay_sentinel.adapters.errors.AdapterAuthError`
  - `relay_sentinel.adapters.errors.AdapterAuthBlockedError`
  - `relay_sentinel.domain.quota.predict_pool_quota`
  - `relay_sentinel.domain.alerts.evaluate_alert`
  - `relay_sentinel.domain.pool_health.summarize_account_health`
  - `relay_sentinel.domain.scheduler.select_due_checks`
  - `relay_sentinel.notifications.webhook.render_webhook_message`
- Secrets must never be returned by API responses or stored as raw JSON/plain text. Store sealed credential blobs under neutral field names, not `"password"` or `"token"`.
- Avoid automatic payment, renewal, recharge, or balance mutation routes in V1.

## File Structure

- Create `relay_sentinel/__init__.py`: package marker.
- Create `relay_sentinel/app.py`: FastAPI factory, route registration, validation error redaction, scheduler flags.
- Create `relay_sentinel/storage.py`: SQLite schema, persistence helpers, secret sealing/opening, CRUD operations.
- Create `relay_sentinel/schemas.py`: Pydantic request validation and response shaping if useful; can be omitted if validation is simpler inside `app.py`.
- Create `relay_sentinel/adapters/errors.py`: adapter exception classes.
- Create `relay_sentinel/adapters/signals.py`: `BalanceSignal` dataclass used by adapters.
- Create `relay_sentinel/adapters/sub2api.py`: Sub2API login, balance fetch, site detection.
- Create `relay_sentinel/adapters/new_api.py`: New API channel balance fetch.
- Create `relay_sentinel/domain/quota.py`: burn-rate and alert prediction.
- Create `relay_sentinel/domain/alerts.py`: cooldown decision logic.
- Create `relay_sentinel/domain/pool_health.py`: owned pool account health summary.
- Create `relay_sentinel/domain/scheduler.py`: due-check selection.
- Create `relay_sentinel/notifications/webhook.py`: alert message rendering.

## Task 1: Baseline Failing Evidence

- [ ] Run backend tests before implementation.

Run: `pytest tests/backend -q`

Expected: FAIL because `relay_sentinel` package or required imports are missing.

- [ ] Run frontend tests to know whether the current UI side is already healthy.

Run: `cd web && npm test -- --runInBand` if supported, otherwise `cd web && npm test`

Expected: PASS or an unrelated pre-existing failure to report separately.

## Task 2: Create Backend Skeleton And Domain Imports

**Files:**
- Create: `relay_sentinel/__init__.py`
- Create: `relay_sentinel/adapters/errors.py`
- Create: `relay_sentinel/adapters/signals.py`
- Create: `relay_sentinel/domain/quota.py`
- Create: `relay_sentinel/domain/alerts.py`
- Create: `relay_sentinel/domain/pool_health.py`
- Create: `relay_sentinel/domain/scheduler.py`
- Create: `relay_sentinel/notifications/webhook.py`

- [ ] Add package directories and minimal functions/classes with real behavior, not stubs.
- [ ] Implement `predict_pool_quota` from the tests:
  - Compare current snapshot against the most recent historical snapshot at or before one hour earlier when available.
  - Compute positive burn rate as previous remaining percent minus current remaining percent divided by elapsed hours.
  - Return infinite hours when burn rate is zero or negative.
  - Alert when either 5H or 7D estimated hours remaining is at or below the threshold, defaulting to 5 hours.
  - Produce the Chinese summary strings asserted by tests.
- [ ] Implement `evaluate_alert`:
  - If not triggered, return `{"action": "clear", ...}`.
  - If triggered and last send event for same target/rule is inside cooldown, return `cooldown_skip`.
  - Otherwise return `send`.
- [ ] Implement `summarize_account_health`:
  - Count total, `status == "ok"` successes, and failures.
  - Alert when failures > 0.
  - Keep text high-level and avoid requiring error taxonomy.
- [ ] Implement `select_due_checks`:
  - Upstream balance due by `last_balance_checked_at + check_interval_seconds`.
  - Pool health and quota are independent schedules.
- [ ] Implement `render_webhook_message`:
  - Include target name, current value, threshold, unit, and renewal/contact instructions.
  - Never claim automatic payment or successful renewal.

Verify: `pytest tests/backend/test_quota_and_alerts.py tests/backend/test_pool_health.py tests/backend/test_manual_checks_and_scheduler.py::test_due_check_selection_respects_upstream_pool_intervals -q`

Expected: PASS for pure domain tests.

## Task 3: Implement Adapters

**Files:**
- Modify: `relay_sentinel/adapters/sub2api.py`
- Modify: `relay_sentinel/adapters/new_api.py`
- Modify: `relay_sentinel/adapters/errors.py`
- Modify: `relay_sentinel/adapters/signals.py`

- [ ] Implement `AdapterAuthError` and `AdapterAuthBlockedError`.
- [ ] Implement `Sub2APIAdapter(base_url, email, password)`:
  - POST `/api/v1/auth/login`.
  - Raise `AdapterAuthBlockedError` for Cloudflare/challenge/403 block responses.
  - Raise `AdapterAuthError` for invalid credential responses.
  - GET `/api/v1/auth/me` with `Authorization: Bearer <access_token>`.
  - Prefer `balance`, fallback to `quota`, unit `USD`, confidence `confirmed`.
- [ ] Implement `detect_sub2api_site(base_url, http_client)`:
  - GET `/api/v1/settings/public`.
  - Return `is_sub2api_like` true when public settings look like Sub2API.
- [ ] Implement `NewAPIAdapter(base_url, admin_token)`:
  - GET `/api/channel/` with bearer token.
  - Raise the same auth/block errors.
  - Sum channel `balance` values and return a normalized `BalanceSignal`.

Verify: `pytest tests/backend/test_sub2api_adapter.py tests/backend/test_new_api_adapter.py -q`

Expected: PASS.

## Task 4: Implement SQLite Storage With Secret Sealing

**Files:**
- Create: `relay_sentinel/storage.py`

- [ ] Create SQLite tables:
  - `upstreams`
  - `pools`
  - `quota_sources`
  - `notification_channels`
  - `alert_events`
  - `alert_actions`
- [ ] Implement schema initialization in app startup/factory.
- [ ] Store public fields as JSON where useful, but do not store credential JSON with raw key names `"password"` or `"token"`.
- [ ] Seal credentials with `secret_key` using a deterministic test-safe method such as XOR plus URL-safe base64, or a standard-library HMAC-derived stream. This is not production-grade cryptography, but it satisfies the V1 test contract better than plain text.
- [ ] Save credential blobs in neutral columns such as `credential_blob`.
- [ ] Provide helpers to return sanitized resources with no credential values and no sensitive key names in response bodies.

Verify: `pytest tests/backend/test_persistence_and_security.py::test_credentials_are_not_stored_as_raw_json_or_plain_text -q`

Expected: PASS.

## Task 5: Implement FastAPI App And Resource APIs

**Files:**
- Create: `relay_sentinel/app.py`
- Modify: `relay_sentinel/storage.py`

- [ ] Implement `create_app(settings: dict | None = None)`.
- [ ] Configure `app.state.scheduler_enabled` and `app.state.scheduler_started`; with `disable_scheduler=True`, scheduler must not start.
- [ ] Add a validation-error handler that redacts submitted secrets from 422 responses.
- [ ] Implement upstream routes:
  - `POST /api/upstreams`
  - `GET /api/upstreams`
  - `GET /api/upstreams/{id}`
  - `PATCH /api/upstreams/{id}`
  - `DELETE /api/upstreams/{id}`
  - `POST /api/upstreams/{id}/test`
  - `POST /api/upstreams/{id}/run-balance-check`
- [ ] Validate upstream rules:
  - Only `new_api` and `sub2api`.
  - `base_url` must be `http` or `https`.
  - threshold value > 0.
  - renewal kind only `manual`, `contact_owner`, `payment_link`.
- [ ] Implement pool routes:
  - `POST /api/pools`
  - `GET /api/pools`
  - `GET /api/pools/{id}`
  - `PATCH /api/pools/{id}`
  - `DELETE /api/pools/{id}`
  - `POST /api/pools/{id}/quota-sources`
  - `POST /api/pools/{id}/test`
  - `POST /api/pools/{id}/run-health-check`
  - `POST /api/pools/{id}/run-quota-check`
- [ ] Validate pool rules:
  - Only `new_api` and `sub2api` as pool platforms.
  - CLIProxyAPI/CPA only allowed as quota source kinds.
  - `base_url` must be `http` or `https`.
  - `quota_alert_threshold_hours > 0`.
- [ ] Implement `GET /api/mobile/home` with separate `upstreams`, `pools`, and `default_business_view: "upstreams"`.

Verify: `pytest tests/backend/test_api_targets.py tests/backend/test_manual_checks_and_scheduler.py tests/backend/test_persistence_and_security.py -q`

Expected: PASS.

## Task 6: Notifications And Alert Event APIs

**Files:**
- Modify: `relay_sentinel/app.py`
- Modify: `relay_sentinel/storage.py`
- Modify: `relay_sentinel/domain/alerts.py`
- Modify: `relay_sentinel/notifications/webhook.py`

- [ ] Implement notification channel routes:
  - `POST /api/notification-channels`
  - `GET /api/notification-channels`
  - `GET /api/notification-channels/{id}`
  - `PATCH /api/notification-channels/{id}`
  - `POST /api/notification-channels/{id}/test`
- [ ] Keep webhook URLs secret in all responses and dry-run results.
- [ ] In dry-run mode, return `dry_run` without network delivery.
- [ ] Implement alert event routes:
  - `POST /api/alerts/events`
  - `GET /api/alerts/events`
  - `POST /api/alerts/events/{id}/ack`
  - `POST /api/alerts/events/{id}/snooze`
  - `POST /api/alerts/events/{id}/rerun`
  - `POST /api/alerts/events/{id}/resolve`
  - `GET /api/alerts/events/{id}/actions`
  - `POST /api/alerts/evaluate`
- [ ] Make alert filtering work for `target_id`, `status`, and `since`.
- [ ] Store lifecycle actions in order.

Verify: `pytest tests/backend/test_notifications_and_alert_events.py -q`

Expected: PASS.

## Task 7: Full Verification And Occham Review

- [ ] Run all backend tests.

Run: `pytest tests/backend -q`

Expected: PASS.

- [ ] Run frontend tests.

Run: `cd web && npm test`

Expected: PASS.

- [ ] Run an Occham review:
  - Remove unused abstractions introduced during implementation.
  - Confirm every new file/function maps to a tested contract or documented boundary.
  - Confirm no automatic payment behavior slipped in.
  - Confirm no secret value or raw secret key name appears in API responses or SQLite bytes.

- [ ] Report final evidence, risks, and practical lessons learned.

