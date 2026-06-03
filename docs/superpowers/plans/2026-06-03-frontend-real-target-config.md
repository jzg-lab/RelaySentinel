# Frontend Real Target Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the production preview frontend add real upstreams and owned pools through the running backend API.

**Architecture:** Keep the existing single-page PWA shape, but add a small API client boundary and local API settings. The UI submits upstream and pool forms to `/api/upstreams` and `/api/pools`, then refreshes real lists without exposing saved credentials.

**Tech Stack:** React 19, TypeScript, Vite, Vitest/jsdom, FastAPI backend.

---

### Task 1: API Settings And Client

**Files:**
- Create: `web/src/api.ts`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] Write failing tests that save backend URL/API key and verify requests include `Authorization: Bearer <key>`.
- [ ] Implement a small API client with `getApiSettings`, `saveApiSettings`, `listTargets`, `createUpstream`, and `createPool`.
- [ ] Wire settings form to localStorage and show connection status.

### Task 2: Visual Add Forms

**Files:**
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] Write failing tests for adding a Sub2API upstream and a New API pool.
- [ ] Replace passive add cards with forms for platform, name, base URL, credentials, threshold, and renewal/quota fields.
- [ ] On submit, post to the backend, clear sensitive fields, refresh lists, and show a toast.

### Task 3: Local Browser Compatibility

**Files:**
- Modify: `relay_sentinel/app.py`
- Add/modify backend test if required.

- [ ] If browser CORS blocks `localhost:4173` to `localhost:8000`, add minimal local CORS support through FastAPI middleware.
- [ ] Keep API key enforcement unchanged for `/api/*`.

### Task 4: Verification

**Files:**
- No production edits expected.

- [ ] Run `npm test` in `web`.
- [ ] Run `npm run build` in `web`.
- [ ] Run focused backend tests if CORS changed.
- [ ] Refresh or restart the local preview and report the usable URL.
