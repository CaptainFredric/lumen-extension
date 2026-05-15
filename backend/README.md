# Lumen API

This is the first backend slice for Lumen. It is intentionally local-first, but it now models the product paths that matter next: captures, watch plans, and explicit agent handoff jobs.

## What it does

1. creates a demo session
2. returns the current session
3. accepts and validates capture history records
4. returns, looks up, and deletes capture records for the active session
5. stores cutaway watch-plan records only after explicit opt-in
6. queues agent handoff jobs only after explicit opt-in and payload review confirmation
7. returns simple session stats and planned integration descriptors

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
4. `POST /v1/session/logout`
5. `GET /v1/captures`
6. `POST /v1/captures`
7. `GET /v1/captures/:id`
8. `DELETE /v1/captures/:id`
9. `GET /v1/stats`
10. `GET /v1/integrations`
11. `GET /v1/watch-plans`
12. `POST /v1/watch-plans`
13. `GET /v1/watch-plans/:id`
14. `PATCH /v1/watch-plans/:id`
15. `DELETE /v1/watch-plans/:id`
16. `GET /v1/agent-jobs`
17. `POST /v1/agent-jobs`
18. `GET /v1/agent-jobs/:id`
19. `PATCH /v1/agent-jobs/:id`

Watch plan creation requires `explicitOptIn: true` or `optIn: true`. Agent job creation also requires `payloadReviewed: true` or `reviewedPayload: true`.

## Smoke Test

```bash
npm run smoke:backend
```

The smoke test starts the API with a temporary data directory, creates a demo session, writes a capture, checks that watch plans reject missing opt-in, writes an opted-in watch plan, queues and completes a reviewed agent job, verifies stats, checks invalid-session rejection, deletes the capture, and removes the temporary store.
