# START HERE — AIsmering in five minutes

## What is this system?

**AIsmering** is a browser-based remote exam proctoring platform (senior-design
capstone, 4-person team, Oct–Dec 2026). It watches webcam/mic/browser behavior
during exams, produces **advisory** flagged events and risk scores, and shows
them to **human proctors**. An LLM writes advisory session summaries. The
system **never** issues automated accusations — that is a hard architectural
constraint (SRS 3.6).

## What is already implemented?

| Piece | Location | State |
|---|---|---|
| ML detection (YOLO phone/person, MediaPipe head-pose/gaze) | `machine learning/` | Working — model `runs/detect/train-4/best.pt`, policy `policy.yaml` (pose_v2) |
| ML demo server (frames over WebSocket) | `machine learning/webcam_demo.py` | Working — `http://127.0.0.1:8000` |
| Frontend (Next.js 15, all 13 modules) | `frontend/` | Working — demo fixtures by default, real backend when `NEXT_PUBLIC_API_ENABLED=true` |
| Backend API (FastAPI + SQLAlchemy + Alembic) | `backend/` | Working — auth, exams, sessions, ML ingestion, risk, review, summaries (LLM-optional), recordings (dev adapter), reports, retention, guarded DB viewer |
| Event worker (queue, ML JSONL bridge, retention) | `backend/app/workers/event_worker.py` | Working |
| Docs (SRS, SDD, plan, system docs) | repo root | Baseline |

## How do I run the application?

```powershell
# 0. Infrastructure (one time; Docker Desktop must be running)
docker compose up -d                 # PostgreSQL 16 on :5433, Redis on :6379

# 1. Backend (one time): migrate + seed
cd backend
$env:DATABASE_URL="postgresql+psycopg://aism:aism-dev@localhost:5433/aism"
python -m alembic upgrade head
python -m scripts.bootstrap          # prints the admin credentials

# 2. Backend API + worker (two terminals, same DATABASE_URL env)
python -m uvicorn app.main:app --port 8010
python -m app.workers.event_worker

# 3. ML inference server (third terminal)
cd "machine learning"
python webcam_demo.py

# 4. Frontend (fourth terminal) — backend-connected mode
cd frontend
npm install
Copy-Item .env.example .env.local   # set NEXT_PUBLIC_API_ENABLED=true
npm run dev                          # http://localhost:3000
```

Note: this machine already runs a native PostgreSQL on port 5432, so the
compose file maps the container to **5433**. Set `QUEUE_BACKEND=redis` to use
the Redis queue; `LOGIN_RATE_LIMIT=100/minute` is convenient for local
testing (the default stays strict).

Demo logins (seeded by bootstrap): `maria.santos@westbridge.edu` / `demo1234`
(student), `e.cruz@westbridge.edu` / `demo1234` (proctor), admin per
`BOOTSTRAP_ADMIN_PASSWORD`.

There is also `.\run-project.ps1` at the repo root (starts ML server +
frontend only).

## Where do I start debugging?

- **Event missing from the proctor view:** check the worker log (queue rows →
  `event_queue` table; dead letters stay there with `last_error`), then the
  ML bridge: the demo server writes `machine learning/events/live_*.jsonl`
  and the worker tails it — the student's exam page must have registered the
  ML session (`ml_session_maps` table).
- **401/403s:** check `audit_log` and roles; roles/institutions are always
  taken from the server-side user row, never the client.
- **Frontend in demo mode when you expected the backend:** `NEXT_PUBLIC_API_ENABLED`.

## What should I avoid modifying?

- `machine learning/pose/`, `machine learning/dataset/`, `machine learning/data/`,
  `machine learning/runs/`, `train.py`, `prep_dataset.py`, `policy.yaml`,
  model weights — protected ML artifacts.
- `policy.yaml` is the source of truth for severities/thresholds; the UI and
  backend only read it (backend mirrors the catalog at bootstrap).

## What should I work on next?

See `docs/INTEGRATION_STATUS.md` — the top items are: wire the remaining
frontend modules to the live API (reports, admin, recordings), an S3
storage adapter, real SSO, and P06 test-person recording for the ML team.
