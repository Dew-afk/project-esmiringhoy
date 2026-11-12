# AIsmering — AI-assisted online exam proctoring

Senior-design capstone (4-person team). Browser-based remote exam monitoring: webcam, microphone and browser behaviour are analyzed in real time, anomalies are scored, and **human proctors** make every call — flags and AI summaries are advisory, never findings.

- **Docs:** `docs/ARCHITECTURE.md` is the master document (design, contracts, subsystem status). `docs/ROLES.md` holds the role contracts; `docs/USER_STORIES.md` tracks per-story status with test evidence.
- **Schema:** `db/schema.sql` is the single database schema (PostgreSQL, port 5433). `db/seed_dev.py` seeds a dev institution, accounts for all four roles and a demo exam.

## Layout

| Path | What |
|---|---|
| `frontend/` | React + Vite client: student exam screen, proctor dashboard, admin, appeals, reports, DB viewer |
| `backend/` | FastAPI auth/sessions/review API (port 8001) + pytest suite |
| `db/` | Single schema + dev seed |
| `ml/` | YOLO + pose/gaze pipeline, live WebSocket demo server (port 8000), training/eval scripts |
| `docs/` | Architecture, roles, user stories |

## Run

```powershell
# one command: ML backend (:8000) + API backend (:8001) + frontend (:5173) + browser
dev.bat
```

First time: create the database from `db/schema.sql`, copy `db/.env.example` to `db/.env`, then `cd db && python seed_dev.py` for dev accounts.

## Test

```powershell
cd backend && python -m pytest tests     # API tests (run against aismering_test)
cd frontend && npx vitest run            # UI tests
```

Per-part requirements: `backend/requirements.txt`, `ml/requirements.txt`, `frontend/package.json`.
