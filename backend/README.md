# Lumen API

This is the first backend slice for Lumen. It is intentionally small and local-first.

## What it does

1. creates a demo session
2. returns the current session
3. accepts capture history records
4. returns the capture history for the active session

## Run it

```bash
npm run api
```

The server listens on `http://127.0.0.1:8787`.

## Endpoints

1. `GET /health`
2. `GET /v1/session`
3. `POST /v1/session/demo`
4. `POST /v1/session/logout`
5. `GET /v1/captures`
6. `POST /v1/captures`
