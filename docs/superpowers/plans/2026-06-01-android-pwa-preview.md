# Android PWA Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable mobile-first RelaySentinel PWA preview with mock data and clickable core flows.

**Architecture:** Create a Vite + React + TypeScript frontend in `web/`. Keep domain calculations in small pure modules with tests. The UI uses mock data only, so the owner can evaluate the Android PWA experience before backend work starts.

**Tech Stack:** React, TypeScript, Vite, Vitest, CSS, PWA manifest.

---

## File Structure

- `web/package.json`: frontend scripts and dependencies.
- `web/index.html`: Vite entry HTML.
- `web/public/manifest.webmanifest`: PWA install metadata.
- `web/public/service-worker.js`: static shell cache placeholder for PWA preview.
- `web/src/main.tsx`: React bootstrap.
- `web/src/App.tsx`: mobile shell and page routing state.
- `web/src/styles.css`: mobile-first visual system.
- `web/src/data/mockData.ts`: preview data.
- `web/src/domain/quota.ts`: quota prediction helpers.
- `web/src/domain/quota.test.ts`: quota helper tests.

## Tasks

### Task 1: Scaffold frontend

- [ ] Create `web/package.json`, `web/index.html`, `web/src/main.tsx`, and `web/src/App.tsx`.
- [ ] Add Vite scripts: `dev`, `build`, `test`.
- [ ] Verify `npm install` succeeds.

### Task 2: Add quota tests first

- [ ] Create `web/src/domain/quota.test.ts`.
- [ ] Test that positive hourly burn predicts remaining hours.
- [ ] Test that zero burn returns `Infinity`.
- [ ] Test that values below 5 hours are considered alerting.
- [ ] Run tests and verify they fail before implementation exists.

### Task 3: Implement quota domain helpers

- [ ] Create `web/src/domain/quota.ts`.
- [ ] Implement `predictHoursRemaining` and `isQuotaBelowThreshold`.
- [ ] Run tests and verify they pass.

### Task 4: Build mock mobile UI

- [ ] Create `web/src/data/mockData.ts`.
- [ ] Implement mobile pages for dashboard, upstreams, pools, notifications, and settings.
- [ ] Add action buttons for rerun, resolve, snooze, open renewal, and copy contact.
- [ ] Keep all actions local-state only.

### Task 5: Add PWA metadata and visual polish

- [ ] Create `manifest.webmanifest` and `service-worker.js`.
- [ ] Add mobile-first CSS based on the Android PWA prototype.
- [ ] Ensure the app is usable at 390px width and desktop preview width.

### Task 6: Verify and hand off

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start dev server and provide the local URL.
- [ ] Commit the frontend preview files.
