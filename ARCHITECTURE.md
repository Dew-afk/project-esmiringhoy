# AIsmering — Architecture

AI-assisted online proctoring platform (senior-design capstone, 4-person team). One document: what the system is, how it fits together, and how to run it.

## 1. System shape

Browser-based remote exam monitoring. It analyzes **webcam, microphone and browser behaviour** in real time, scores anomalies, and presents them to **human proctors**. An LLM produces **advisory, timestamped** session summaries from structured event data only.

**Hard rules that shape every decision:**

- **Human-in-the-loop** — no automated accusations. Flags and AI summaries are advisory, never findings.
- Every LLM summary statement must **trace to `EventsFlags` rows** (validated before storage).
- **FERPA/GDPR**: consent, encryption in transit and at rest, data minimization, retention/purge.
- Mock/test data confined to a **dedicated test Institution**; deletion is role-gated and audit-logged.
- **Live view of active sessions is explicitly deferred** (documented only, unscheduled).

### Target architecture (layered, event-driven)

```
CLIENT LAYER        Test-Taker Client            Proctor Dashboard
                    (consent, calibration,       (risk scores, flag review,
                     capture, exam UI)            AI summary, export, DB viewer)
                          │ signals/events              ▲ live scores & flags
API & INGESTION     REST/WebSocket Ingestion API → Message Queue (Kafka/Kinesis)
PROCESSING          CV/ML Inference    Stream Processor (fusion, risk, persist)    LLM Summarizer
DATA                Relational DB (users, exams, sessions, events, scores,
                    summaries, audit)  +  Encrypted Object Storage (media; DB holds pointers)
MANAGEMENT          Exam Lifecycle · Accounts · Reporting · Retention Job
```

### Subsystems and status

| # | Subsystem | Status |
|---|-----------|--------|
| 1 | Test-Taker Client | **Partial** — consent/calibration/capture/exam UI as the React client + live demo |
| 2 | CV/ML Inference | **Mostly done** — YOLO + pose/gaze live and offline; audio not started |
| 3 | Ingestion API + Queue | Not started |
| 4 | Stream Processor | Not started |
| 5 | Storage Layer | Not started (events persist as JSONL files only) |
| 6 | LLM Summarization | Not started |
| 7 | Proctor Dashboard | **Partial** — full frontend skeleton, placeholders until the backend exists |
| 8 | User & Account Mgmt | Not started (sign-in screen is a stub) |
| 9 | Exam Management | Not started (admin UI is a skeleton) |
| 10 | Reporting & Compliance | Not started (reports UI is a skeleton) |

## 2. Repository layout

```
sd3/
├── ARCHITECTURE.md               # This file (the only doc)
├── dev.bat                       # Starts backend + client + browser, one command
├── client/                       # React frontend (Vite)
│   ├── src/
│   │   ├── tokens.css            # The design system: 3 colours + derived shades + type scale
│   │   ├── design.css            # App-wide styles: glass, buttons, tables, chips, live session
│   │   ├── signin.css            # Sign-in screen styles (scoped under .signin)
│   │   ├── App.jsx               # Shell: hash router, auth gate, orbs/dot-grid, nav
│   │   ├── LiveSession.jsx       # Real live camera screen (WebSocket to the ML backend)
│   │   ├── ui.jsx                # Shared: Panel, Banner, Empty, Field
│   │   └── screens/              # SignInPage, Student, Dashboard, Admin, Appeals,
│   │                             #   Reports, DbViewer
│   ├── index.html                # Fonts (Space Grotesk + Silkscreen)
│   └── vite.config.js            # Proxies /ws to :8000
└── machine learning/             # ML workstream (subsystem 2)
    ├── webcam_demo.py            # Live demo backend: FastAPI + WS on :8000, YOLO + pose
    ├── webcam.html               # Legacy single-file demo client (superseded by client/)
    ├── train.py                  # Training entry: --preset stage1|stage2, --eval-test
    ├── prep_dataset.py           # CVAT XML → YOLO splits; negatives, --exclude, leak checks
    ├── extract_frames.py         # Raw videos → staged frames for negative review
    ├── eval_fp.py                # Multi-model false-positive review over video frames
    ├── policy.yaml               # Severity catalog + pose thresholds + yolo conf floors
    ├── pose/                     # Head-pose & gaze pipeline (own venv, mediapipe)
    │   ├── extract.py detect.py evaluate.py wrap.py annotate.py
    │   ├── live_monitor.py       # Incremental live detector (used by the demo server)
    │   ├── gaze_utils.py         # Shared iris-gaze geometry
    │   └── face_landmarker.task  # MediaPipe asset (paths with spaces break it)
    ├── dataset/                  # Raw data, never modified: CVAT image datasets + videos
    ├── data/                     # Generated: YOLO splits, staged frames, approval lists
    ├── events/                   # EventsFlags records (JSONL/CSV), live session logs
    └── runs/detect/              # Trained models: train-4 current, train-3/7/6/2 history
```

## 3. Data contracts

### EventsFlags record (what the DB table should mirror)

```json
{
  "event_id": "live_20261003_234112-0001",
  "session_id": "live_20261003_234112",
  "event_type": "gaze_deviation",
  "severity": "medium",
  "start_s": 16.537,
  "end_s": 18.582,
  "duration_s": 2.045,
  "peak_yaw_dev": 1.19,
  "peak_gaze_dev": 0.303,
  "detector": "pose_mediapipe",
  "policy_ref": "pose_v2"
}
```

`detector` is `pose_mediapipe` (pose/gaze) or `yolo11n` (object/person). Live records come from `webcam_demo.py` → `events/live_<ts>.jsonl`; offline ones from `pose/wrap.py` → `events/eventsflags.jsonl`. Planned DB tables: `UserAccount, Institution, Exam, ExamSession, ProctoringPolicy, RosterAssignment, Consents, EventsFlags, RiskScores, Recordings, SessionSummaries, AuditLog, RetentionLog` — `ExamSession` is the anchor.

### WebSocket protocol (`/ws`) — the integration contract

- **Client → server:** binary JPEG frame, one per message (~15 fps)
- **Server → client (JSON):** `{ boxes: [{x1,y1,x2,y2,conf,label}], gaze: {x,y,dx,dy} | null, ms, state: "calibrating"|"live", seconds_remaining, events: [...] }`
- First 10 s are calibration (no events); events are reported **on completion**, after debounce (`min_dur_s` / `merge_gap_s` from `policy.yaml`)

### Event catalog (severities in `policy.yaml`)

| Event | Severity | Source | Status |
|---|---|---|---|
| `gaze_deviation` | medium | MediaPipe iris gaze | live + offline |
| `head_pose_deviation` | medium | MediaPipe head pose | live + offline |
| `unauthorized_object` | high | YOLO phone class | live |
| `second_person` | critical | YOLO 2+ person boxes | live |
| `second_voice` | high | audio | not started |
| `focus_loss` / `copy_paste` / `connectivity_interruption` | medium / low / low | browser + network | not started |

## 4. ML workstream

**Dataset pipeline** (all seeded, re-runnable, raw data never modified):
1. `prep_dataset.py` — CVAT XML → YOLO labels; `--with-test` for a 70/15/15 split; `--exclude data/exclude.txt` skips duplicate burst twins; staged video frames become negatives only for paths approved in `data/negatives_approved.txt`, split by **person** per `dataset/video dataset/splits.json`. Final checks fail loudly on cross-split names/sessions and report suspected near-duplicates (dhash).
2. `extract_frames.py` — samples raw videos at 2 s intervals into `data/_video_frames/` for negative review.
3. `train.py` — `--preset stage1` (fresh, yolo11n.pt @ imgsz 960, batch 8) or `--preset stage2` (fine-tune with freeze 10, lr0 0.001); `--eval-test` runs `val(split="test")` after training.
4. `eval_fp.py` — candidate false-positive review over video frames, comparing any models (`coco`, `train-7`, `train-4`, …), with per-threshold detections/hour.

**Current split (deduped + negatives):** 343/74/74 CVAT positives with 715/349/471 approved video-frame negatives in train/val/test.

**Models** (`runs/detect/`):

| Run | What | Test split (74 pos + 471 neg) |
|---|---|---|
| train-7 | old data, 1,235 images incl. duplicates | P .959 / R .972 / mAP50 .982 (inflated by burst leakage) |
| train-3 | stage-1: deduped data + video negatives, imgsz 960 | P .928 / R .901 / mAP50 .924 |
| **train-4** (current) | stage-2 fine-tune of train-7 on the train-3 dataset | **P .969 / R .973 / mAP50 .971**, 0 phone FPs and 0 double-boxes on P02 video frames |

`policy.yaml` is the single source of truth: severity catalog, pose thresholds (`pose_v2`: baseline 10 s, head 12°, gaze 0.7, min 1.0 s, merge 0.5 s), and per-class YOLO confidence floors (`yolo.conf_phone` / `yolo.conf_person`, 0.35).

## 5. Frontend

**Stack:** Vite + React 18, hash routing (no router dependency), Space Grotesk + Silkscreen from Google Fonts.

**Design system** (`src/tokens.css`, locked in `client/design.md` history): exactly three colours —
- `--c-primary: #8B7BFF` (focus rings, glows, orbs, gaze ray, detection boxes)
- `--c-secondary: #0B0A18` (page, glass tint, text on fills)
- `--c-detail: #F4F3FF` (all text, icons, borders) — plus `--c-primary-soft: #AB9FFF`, the primary stepped 30% toward detail, because the pure hue cannot reach 7:1 with any dark text

Every other shade is one of the three with opacity changed. Text contrast is measured at 7:1 or better everywhere. Glassmorphism: panels are `rgba(SECONDARY, .55)` with `backdrop-filter: blur(20px) saturate(140%)`, 24px radius, DETAIL 25% rim, over a dot-grid and three drifting violet orbs. All motion is wrapped in `prefers-reduced-motion: no-preference`. Severity and lifecycle states use labels + opacity ladders, never colour alone.

**Screens** (hash routes):
- `#/login` — sign-in gate: role radiogroup, email/password with show toggle, tenant select (admin only), SSO secondary button, honest "not connected" note in dev mode. Replaces the whole shell until signed in.
- `#/student` — consent gate → exam strip (timer, non-punitive notice, tech support) → the live camera screen (`LiveSession.jsx`: mirrored video, violet gaze ray + boxes, calibration segments, event feed with severity chips)
- `#/dashboard` — sessions table → review screen (acknowledge/dismiss, escalate with recording ref + risk context, notes, severity override keeping the original, bulk-dismiss for low severity, advisory risk score and AI summary panel, playback/export with unavailable state)
- `#/admin` — exams (create/edit, lifecycle Draft→Archived), policy templates, rosters with accommodations, accounts
- `#/appeals` — cases, flags, notes
- `#/reports` — session integrity, cohort analytics, audit/compliance
- `#/db` — read-only institution-scoped viewer; guarded delete with confirmation; AuditLog/RetentionLog/Consents blocked

Every data region has four states (loading/empty/error/full). Backend-dependent screens show labeled placeholder rows ("sample layout, not real records") — no invented data anywhere.

## 6. Running it

```powershell
dev.bat                          # from sd3/: backend (:8000) + client (:5173) + browser
```

Or manually:
```powershell
cd "machine learning" && python webcam_demo.py     # needs torch, ultralytics, mediapipe, fastapi
cd "client" && npm install && npm run dev          # → http://localhost:5173
```

Offline pose pipeline: `machine learning/pose/.venv` → `python extract.py | detect.py | evaluate.py | wrap.py`. Training runs from `machine learning/` (`data/dataset.yaml` resolves from the cwd). Windows: keep `__main__` guards in scripts that train or use dataloaders; `workers=0` by default (RAM pressure).

## 7. Honest gaps

- Not started: audio, browser events, ingestion API + queue, stream processor, database, LLM summarizer, accounts/auth (sign-in is a stub), exam management backend, reporting, retention job.
- Live events persist as JSONL, not a DB; the frontend's backend-dependent screens are skeletons with labeled placeholders.
- Pose test numbers are small-n (one test person, ~16 min); the live camera state is verified by contract and lint, not by screenshot.
- Duplicate bursts were excluded from training (769 images); remaining near-duplicates (dhash 1–4) still straddle splits.
- `webcam.html` is the legacy single-file demo, superseded by `client/`; `machine learning/README.md`-era model references are historical.
