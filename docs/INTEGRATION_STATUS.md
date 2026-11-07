# Integration Status — AIsmering

Updated 2026-11-07. Statuses: **Working** (verified end-to-end),
**Partial** (implemented, not yet wired/verified together), **Blocked**
(environmental), **Not Started**.

## Working

| Feature | Backend | Frontend |
|---|---|---|
| Authentication (bcrypt + JWT, configurable rate limit, pending-proctor gate) | `POST /auth/login`, `/auth/register`, `/auth/me`, `/auth/consent` | `/login`, `/register` (api mode) — verified |
| Student exams + session lifecycle (idempotent start/end, roster/window/consent checks, server-enforced transitions) | `/exams/*`, `/sessions/*` | `/student`, `/student/check-in` (api mode) — verified |
| ML event ingestion (verified mapping, token-authenticated, deduped, durable queue: **db or Redis**, retry/dead-letter) | `POST /ml/events`, `POST /sessions/{id}/ml-register`, worker | exam page registers ML session on first event (api mode) |
| Advisory risk scoring (configurable weights, labeled unapproved defaults) | `GET /ml/weights`, worker accumulates `RiskScores` | proctor dashboard shows real scores (api mode) |
| Proctor monitoring + review workflow (acknowledge/dismiss/escalate/note/override/bulk, audit-logged, original severity retained) | `/sessions/*`, `/events/*/review`, `/sessions/*/bulk-review` | `/proctor`, `/proctor/sessions/[id]` (api mode) — verified |
| **Administration** (users, institutions, approvals, CSV import, exam CRUD + lifecycle, policy templates) | `/admin/*`, `/exams/*` | `/admin/users`, `/admin/exams` (api mode) — verified |
| **Reports** (integrity, cohort analytics, audit, appeals package/cases) | `/reports/*` | `/admin/reports` (api mode, real cohort/risk/type data) — verified |
| **Recordings** (metadata, availability, signed short-lived export, audited) | `/sessions/*/recordings`, `/sessions/recordings/*` | session detail recordings panel (api mode) — verified; **client-side capture not implemented** |
| **Appeals** (cases = escalated events, evidence, notes) | `/reports/appeals`, `/reports/appeals-package/*` | `/appeals` (api mode) — verified |
| Database viewer (allowlist, read-only default, test-institution deletion) | `/admin/db/*` | `/admin/db` (api mode, guarded delete) — verified |
| **PostgreSQL 16** (docker compose, port 5433) + **Redis 7** | migrations round-trip, full suite green on both DBs, Redis queue tests | n/a |
| Live ML demo (YOLO train-4 + MediaPipe, 15 fps WS contract) | untouched | camera preview + calibration + event feed — verified via smoke test |
| End-to-end integration tests (student→proctor workflow + all four modules) | `backend/tests/integration/` — 6 tests | pass against live API + worker + Postgres |

## Partial

- **AI summaries**: backend implemented (traceability-validated, 503 when no
  LLM configured); frontend shows the honest unavailable panel until a
  provider key is configured.
- **Recording capture**: backend + export wired; the browser-side recording
  capture is not implemented (honest "no recordings" state shown).
- **PDF/CSV report files**: analytics endpoints wired; file generation is not
  implemented server-side (export buttons disabled honestly).

## Blocked

- **SSO**: no IdP configured — SSO stays disabled (honest, not fabricated).
- **Encrypted object storage**: no S3 provider — dev-local plaintext adapter
  is loudly labeled; production requires SSE/S3.
- **Live ML inference**: not exercised by the automated suite (no camera/GPU
  guarantee) — simulated payloads verify the pipeline; the earlier WS smoke
  test verified the real server contract.

## Known bugs / caveats

- `webcam_demo.py` binds `127.0.0.1:8000`, one session at a time, no auth —
  the backend never trusts it without the mapping + ingest token.
- SQLite returns naive datetimes; comparisons go through `models.ensure_utc`
  (verified on both backends).
- The frontend exam countdown is session-local; authoritative timing is the
  backend `ExamSession.start_time` + exam duration.
- Risk weights and `pose_v2` thresholds are unapproved defaults pending team
  adoption.
- A native PostgreSQL service already occupies host port 5432 on this machine;
  the compose file maps the container to 5433.

## Next implementation priority

1. Configure a real LLM provider and enable summaries end-to-end.
2. Browser-side recording capture + upload to the backend.
3. Provision S3-compatible storage and switch `STORAGE_PROVIDER`.
4. Record ML test person P06 (new human, bright_front).
