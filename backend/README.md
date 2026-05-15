# Lumen API

This is the first backend slice for Lumen. It is intentionally local-first, but it now models the product paths that matter next: captures, watch plans, and explicit agent handoff jobs.

## What it does

1. creates a demo session
2. returns the current session
3. returns a shared entitlement contract for the active plan
4. stores retention and delete controls for session-owned backend data
5. accepts and validates capture history records
6. returns, looks up, and deletes capture records for the active session
7. stores cutaway watch-plan records only after plan access and explicit opt-in
8. queues agent handoff jobs only after plan access, explicit opt-in, and payload review confirmation
9. returns simple session stats and planned integration descriptors

## Run it

```bash
npm run api
```

The server listens on `http://127.0.0.1:8787`.

For isolated local testing:

```bash
LUMEN_API_PORT=8788 LUMEN_API_DATA_DIR=/tmp/lumen-api npm run api
```

## Endpoints

1. `GET /health`
2. `GET /v1/session`
3. `POST /v1/session/demo`
4. `GET /v1/entitlements`
5. `POST /v1/session/logout`
6. `GET /v1/captures`
7. `POST /v1/captures`
8. `GET /v1/captures/:id`
9. `DELETE /v1/captures/:id`
10. `GET /v1/stats`
11. `GET /v1/integrations`
12. `GET /v1/data-controls`
13. `PATCH /v1/data-controls`
14. `DELETE /v1/account-data`
15. `GET /v1/watch-plans`
16. `POST /v1/watch-plans`
17. `GET /v1/watch-plans/:id`
18. `PATCH /v1/watch-plans/:id`
19. `DELETE /v1/watch-plans/:id`
20. `GET /v1/agent-jobs`
21. `POST /v1/agent-jobs`
22. `GET /v1/agent-jobs/:id`
23. `PATCH /v1/agent-jobs/:id`

Demo sessions accept `plan: "free"`, `"demo-pro"`, `"team"`, or `"enterprise"`. This is an entitlement test harness, not production billing. Watch plan creation requires a plan with `regionWatch` access plus `explicitOptIn: true` or `optIn: true`. Agent job creation requires `agentHandoff` access plus explicit opt-in and `payloadReviewed: true` or `reviewedPayload: true`.

Data controls allow retention values of `7`, `30`, `90`, `180`, `365`, or `0` for manual delete only. `cloudSyncEnabled: true` requires a plan with `cloudSync` access. `DELETE /v1/account-data` requires `confirmation: "DELETE LUMEN DATA"` and removes captures, watch plans, agent jobs, and saved data controls for the active session.

## Smoke Test

```bash
npm run smoke:backend
```

The smoke test starts the API with a temporary data directory, checks that a free plan cannot create paid watch, agent, or cloud-sync records, creates a team session, verifies retention controls, writes a capture, checks that watch plans reject missing opt-in, writes an opted-in watch plan, queues and completes a reviewed agent job, verifies stats, checks invalid-session rejection, deletes all session backend data, and removes the temporary store.
