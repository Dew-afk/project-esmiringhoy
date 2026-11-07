# AIsmering Backend

FastAPI + SQLAlchemy 2 + Alembic. One modular API, one event worker, one
database (PostgreSQL 16 via Docker; SQLite works identically), one durable
queue (db or Redis behind the same interface).
All detections and risk scores are advisory — human proctors decide.

## Setup (verified on this machine, Python 3.13)

```powershell
docker compose up -d    # from repo root: Postgres on :5433, Redis on :6379
cd backend
python -m pip install -r requirements.txt
$env:DATABASE_URL="postgresql+psycopg://aism:aism-dev@localhost:5433/aism"
python -m alembic upgrade head
python -m scripts.bootstrap        # seeds institutions, policies (mirrors
                                   # machine learning/policy.yaml), admin,
                                   # proctor, student, exam — idempotent
```

Note: a native PostgreSQL service already owns host port 5432 on this machine,
so the compose file maps the container to 5433.

## Run

```powershell
$env:DATABASE_URL="postgresql+psycopg://aism:aism-dev@localhost:5433/aism"
python -m uvicorn app.main:app --port 8010   # API
python -m app.workers.event_worker           # queue consumer + ML bridge + retention
```

Optional: `QUEUE_BACKEND=redis` (default `db`) switches the queue to Redis
lists (reliable-queue pattern, attempts counter, dead list) with no code
changes. `LOGIN_RATE_LIMIT` defaults to `5/minute`; raise it for local
development.

- `GET /health` — db/LLM/storage status.
- Interactive docs: `http://127.0.0.1:8010/docs`.

## Environment (see `.env.example`)

Required in production: `DATABASE_URL` (PostgreSQL), `JWT_SECRET`,
`ML_INGEST_TOKEN`, `BOOTSTRAP_ADMIN_PASSWORD`. Optional: `LLM_API_KEY` /
`LLM_BASE_URL` / `LLM_MODEL` (summaries), `RETENTION_DAYS_DEFAULT` (0 =
retention not configured → purge does nothing), `RISK_WEIGHTS` (advisory
severity weights — unapproved defaults until adopted), `STORAGE_PROVIDER`
(`local` = dev-only plaintext adapter).

## Tests

```powershell
python -m pytest tests/ -q            # unit/API tests (SQLite, no GPU)
# same suite on PostgreSQL 16:
AISM_TEST_DATABASE_URL="postgresql+psycopg://aism:aism-dev@localhost:5433/aism" python -m pytest tests/ -q --ignore=tests/integration
python -m pytest tests/test_queue_redis.py -q   # Redis queue backend
python -m pytest tests/integration -q # 6 live e2e tests: API on :8010 + worker running
```

The integration test replays the exact frontend workflow: login → exams →
session start (idempotent) → ML mapping → trusted ingestion → worker →
risk score → proctor review → audit trail → session end.

## Key flows

- **ML ingestion (trusted only):** student registers the ML session id for
  their exam session (`POST /sessions/{id}/ml-register`, owner-only); events
  enter via `POST /ml/events` (`X-ML-Token`) or the worker tailing
  `ML_EVENTS_DIR`. Unmapped ML sessions are ignored.
- **Review:** every action audit-logged; severity overrides retain the
  original detector value; bulk-dismiss limited to low severity.
- **Summaries:** structured EventsFlags metadata only; every statement must
  reference an event of the session, else rejected; 503 when no LLM is
  configured.
- **Recordings:** dev-local adapter only; short-lived HMAC-signed download
  URLs; export = completed sessions, proctor-only, audit-logged.
- **Retention:** purges only with explicit institution/env configuration;
  dependency-order deletion; `RetentionLog` entries; idempotent.
- **DB viewer:** table allowlist, institution-scoped, read-only default;
  deletion restricted to a verified test institution and audit-logged.
