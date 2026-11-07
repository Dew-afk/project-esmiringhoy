# CLAUDE.md — AIsmering project orientation

AI-driven online proctoring & anti-cheat system (capstone, Oct–Dec 2026).
**Hard rule: detections, risk scores, and AI summaries are advisory — human
proctors decide; the system never issues automated accusations.**

## Layout

- `frontend/` — Next.js 15 UI (all 13 modules). Demo fixtures by default;
  `NEXT_PUBLIC_API_ENABLED=true` uses the real backend via `src/lib/live-api.ts`.
- `backend/` — FastAPI + SQLAlchemy 2 + Alembic. One API (`app/main.py`) +
  one worker (`app/workers/event_worker.py`). **PostgreSQL 16 via
  `docker compose up -d` (port 5433 — a native Postgres owns 5432);** SQLite
  still works with no code change. Queue: `QUEUE_BACKEND=db|redis`
  (both verified).
- `docker-compose.yml` — dev PostgreSQL + Redis.
- `machine learning/` — **protected**: `pose/`, `dataset/`, `data/`, `runs/`,
  `train.py`, `prep_dataset.py`, `policy.yaml`, model weights. Never modify,
  never retrain. `policy.yaml` is the source of truth for severities.
- `docs/` — START_HERE, ARCHITECTURE, INTEGRATION_STATUS.

## Source of truth (conflict order)

1. Running source code. 2. `SYSTEM_DOCUMENTATION.md`. 3. `ML_HANDOFF.md`.
4. `PROJECT_PLAN.md`. 5. SRS/SDD PDFs.

## Commands

```powershell
# infrastructure
docker compose up -d                           # Postgres :5433 + Redis :6379

# backend (set $env:DATABASE_URL to the postgres URL for PG runs)
cd backend
python -m pytest tests/ -q                    # unit + API tests
AISM_TEST_DATABASE_URL="postgresql+psycopg://aism:aism-dev@localhost:5433/aism" python -m pytest tests/ -q --ignore=tests/integration   # same suite on Postgres
python -m pytest tests/test_queue_redis.py -q # Redis queue backend (needs Redis up)
python -m alembic upgrade head                 # migrate
python -m scripts.bootstrap                    # seed (prints admin creds)
python -m uvicorn app.main:app --port 8010     # API
python -m app.workers.event_worker             # worker

# frontend
cd frontend
npm run typecheck && npm run lint && npm test && npm run build

# ML demo
cd "machine learning"; python webcam_demo.py   # :8000

# integration tests (API + worker running)
cd backend; python -m pytest tests/integration -q   # 6 tests, incl. 4-module coverage
```

## Conventions

- UTC timestamps internally; presentation-local formatting lives in the frontend.
- Events keep the EventsFlags field names from `ML_HANDOFF.md` §3.2.
- Every sensitive mutation writes `AuditLog`; institution scoping on every query.
- Test-institution deletion only through the DB viewer; `AuditLog`,
  `RetentionLog`, `Consents` are never deletable.
- Secrets come from env only (see `backend/.env.example`, `frontend/.env.example`);
  no hardcoded credentials; the LLM receives structured event metadata only —
  never media or biometrics.
