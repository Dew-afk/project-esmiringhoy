# SD3 — AI-Driven Online Proctoring & Anti-Cheat System: Complete System Documentation

> Consolidated from `PROJECT_PLAN.md` (plan of record), `ML_HANDOFF.md`, the pose/ML READMEs, and every source file in the repository.
> Generated: 2026-10-27; updated 2026-10-28 (FP-reduction work: deduped dataset, video negatives, stage-1/stage-2 models, FP review tooling). Where documents disagree, the code and data files on disk are treated as the truth.

---

## 1. Project Overview

A browser-based remote exam monitoring platform for a senior-design capstone (4-person team, one academic term, Oct–Dec 2026). It analyzes **webcam, microphone, and browser behavior** in real time, scores anomalies, and presents them to **human proctors**. An LLM produces **advisory, timestamped** session summaries from structured event data only.

**Hard rules that shape every implementation decision:**

- **Human-in-the-loop** — no automated accusations. Flags and AI summaries are advisory, never findings.
- Every LLM summary statement must **trace to `EventsFlags` rows** (validated before storage).
- **FERPA/GDPR**: consent, encryption in transit and at rest, data minimization, retention/purge.
- Mock/test data confined to a **dedicated test Institution**; the deletion tool is role-gated and audit-logged.
- **Live view of active sessions is explicitly deferred** (documented only, unscheduled).

---

## 2. Architecture (Target)

Style: **layered, event-driven**, stateless processing services decoupled by a message queue.

```text
┌─────────────────────── CLIENT LAYER ───────────────────────┐
│  Test-Taker Client            Proctor Dashboard            │
│  (capture, calibration,       (risk scores, flag review,   │
│   exam UI, notices)            AI summary, playback/export,│
│                                DB viewer)                  │
└───────┬─────────────────────────────▲──────────────────────┘
        │ signals/events              │ live scores & flags
        ▼                             │
┌─────────────── API & INGESTION LAYER ──────────────────────┐
│  REST/WebSocket Ingestion API  →  Message Queue (Kafka/    │
│                                   Kinesis)                 │
└───────┬────────────────────────────────────────────────────┘
        ▼
┌─────────────────── PROCESSING LAYER ───────────────────────┐
│  CV/ML Inference     Stream Processor        LLM Summarizer│
│  (pose, gaze,        (fusion, risk score,    (reads only   │
│   audio, visual)      persist)                EventsFlags) │
└───────┬──────────────────────────┬─────────────────────────┘
        ▼                          ▼
┌───────────────────────── DATA LAYER ───────────────────────┐
│  Relational DB                    Encrypted Object Storage │
│  (users, exams, sessions,         (audio/video; DB holds   │
│   events, scores, summaries,       only pointers)          │
│   audit/retention logs)                                    │
└───────┬────────────────────────────────────────────────────┘
        ▼
┌──────────────────── MANAGEMENT LAYER ──────────────────────┐
│  Exam Lifecycle · User/Account Mgmt · Reporting & Compliance│
│  · Scheduled Retention/Purge Job                           │
└────────────────────────────────────────────────────────────┘
```

### 2.1 The ten subsystems and their status

| # | Subsystem | Responsibility | Status (2026-10-27) |
|---|-----------|----------------|---------------------|
| 1 | Test-Taker Client | Consent, device check, calibration, capture, exam UI, non-punitive notices, tech-support button | **Partial** — capture + calibration exist as the demo client (`webcam.html`) |
| 2 | CV/ML Inference Services | Head pose, gaze, audio classification, object/person detection | **Mostly done** — YOLO FP-tuned (leakage-free test split, video negatives) + pose/gaze live and offline; audio not started |
| 3 | Ingestion API + Message Queue | Absorb load spikes from concurrent sessions | Not started (contract defined in `ML_HANDOFF.md` §3) |
| 4 | Stream Processor | Multimodal fusion, risk scoring, persistence, live push | Not started (contract: consume `EventsFlags` + `policy.yaml`) |
| 5 | Storage Layer | Relational schema, encrypted object storage, retention | Not started (events currently persist as JSONL files only) |
| 6 | LLM Summarization Service | Chronological, timestamped, advisory narratives | Not started |
| 7 | Proctor Dashboard | Monitoring, review actions, playback/export, DB viewer | Not started |
| 8 | User & Account Management | Roles, tenants, SSO, consent | Not started |
| 9 | Exam Management & Delivery | Exam config, policies, rosters, lifecycle state machine | Not started |
| 10 | Reporting & Compliance | Integrity reports, cohort analytics, appeals packages, audit reports | Not started |

### 2.2 Key data flow

1. The client captures signals; ML flags are published to the ingestion API, then the queue.
2. The stream processor fuses modalities, applies the policy severity map, and writes `EventsFlags` and `RiskScores`.
3. Recordings stream to encrypted object storage; only a pointer goes in `Recordings`.
4. The dashboard receives live updates.
5. At exam end or on demand, the summarizer reads `EventsFlags` rows, validates that every statement maps to a row, and stores the result in `SessionSummaries`.
6. Recording export uses short-lived presigned URLs; every export is audit-logged.

### 2.3 Data model

- **Identity and exam:** `UserAccount`, `Institution`, `Exam`, `ExamSession`, `ProctoringPolicy`, `RosterAssignment`, `Consents`
- **Monitoring:** `EventsFlags`, `RiskScores`
- **Media and AI:** `Recordings`, `SessionSummaries`
- **Governance:** `AuditLog`, `RetentionLog`

`ExamSession` is the anchor record: many `EventsFlags`, one `RiskScores` row, many `Recordings`, at most one `SessionSummary`.

### 2.4 Design rationale

| Decision | Why |
|----------|-----|
| Event-driven over synchronous | Client latency would otherwise grow with ML load |
| Human-in-the-loop over automation | False positives are unacceptable in high-stakes exams |
| Media separated from metadata | Keeps the DB small; simplifies encryption and retention |
| LLM data minimization | Only structured, non-biometric fields are sent |
| Stateless services over a monolith | Horizontal scaling; graceful degradation to recording-only mode |

---

## 3. Requirements

### 3.1 Event catalog (severity map — also in `policy.yaml`)

| Event type | Severity | Source | Status |
|---|---|---|---|
| `gaze_deviation` | medium | MediaPipe iris gaze | ✅ live + offline |
| `head_pose_deviation` | medium | MediaPipe head pose | ✅ live + offline |
| `unauthorized_object` | high | YOLO (phone class) | ✅ live |
| `second_person` | critical | YOLO (2+ person boxes) | ✅ live |
| `second_voice` | high | audio classification | ⏳ not started |
| `focus_loss` | medium | browser behavior | ⏳ partner's part |
| `copy_paste` | low | browser behavior | ⏳ partner's part |
| `connectivity_interruption` | low | network monitoring | ⏳ partner's part |

### 3.2 Functional requirements (condensed)

| Area | Key requirements |
|------|------------------|
| Image processing | Pitch/yaw/roll head pose; gaze and pupil tracking; baseline calibration with configurable drift threshold |
| Machine learning | Acoustic classification; object/person detection; multimodal fusion; bias mitigation; confidence thresholds |
| Behavioral monitoring | Tab-switch, copy-paste, focus-loss tracking; encrypted session recording; real-time risk dashboard |
| Proctor review actions | Acknowledge/dismiss, escalate, add note, override severity (original retained), bulk-dismiss low-severity |
| Data pipeline | Queue-based ingestion, stream processing, structured + media storage, scheduled retention purge |
| AI summary | Auto or on-demand; reads only structured rows; chronological, timestamped; stored with model version; shown in a separate labeled panel |
| Accounts | Four roles (Student, Instructor/Proctor, Admin, Appeals Reviewer); tenant provisioning; CSV/SIS import; password and SAML/OAuth SSO; consent grant/revoke |
| Exam management | Exam config, accommodations, policy templates, lifecycle (Draft → Scheduled → In Progress → Completed → Archived) |
| Student experience | Check-in, calibration, timer UI, non-punitive notices, tech-support escalation without pausing proctoring |
| Reports | Session integrity (PDF/CSV), cohort analytics, appeals package, audit/compliance |
| Proctor enhancements (SDD v01.01) | Completed-session recording export, read-only DB viewer, guarded deletion of mock/test data |

### 3.3 Non-functional

- **Usability:** prioritized dashboard; low-friction setup; flags with timestamp and thumbnail context; AI panel visibly distinct from raw flags.
- **Reliability:** continuous monitoring; transient interruptions logged; fallback to recording-only mode; dashboard keeps working if the LLM is down.
- **Performance:** near-continuous frame analysis; low-latency risk updates; scales with concurrent sessions; summaries in seconds.
- **Security:** encryption in transit and at rest; role-restricted access with audit trail; LLM data minimization.

### 3.4 Out of scope

- Exam question authoring and item banks; grading and scoring
- Identity verification at account creation (assumed upstream)
- Optional live view of active sessions (SDD 5.9): documented only, no WBS package, no schedule
- Project scheduling/staffing/budget detail (in the SPMP)

---

## 4. Repository Layout

```
sd3/
├── PROJECT_PLAN.md               # Plan of record: architecture, 10 subsystems, milestones, risks
├── ML_HANDOFF.md                 # Partner-facing ML handoff + integration contract
├── SYSTEM_DOCUMENTATION.md       # This file
└── machine learning/             # ML training workspace (subsystem 2)
    ├── train.py                  # YOLO training entry point (stage1/stage2 presets, --eval-test)
    ├── prep_dataset.py           # CVAT XML → YOLO; test split, negatives, --exclude, leak checks
    ├── extract_frames.py         # raw videos → staged frames (data/_video_frames) for negative review
    ├── eval_fp.py                # multi-model false-positive review over staged frames
    ├── webcam_demo.py            # Integrated live demo server (FastAPI + WebSocket)
    ├── webcam.html               # Demo client (camera capture, canvas, event panel)
    ├── policy.yaml               # Single source of truth: severity catalog + pose + yolo thresholds
    ├── requirements.txt          # ultralytics, opencv-python, fastapi, uvicorn (incomplete — see §10)
    ├── pose/                     # Head-pose & gaze workstream
    │   ├── extract.py            # video → per-frame features CSV
    │   ├── detect.py             # features → deviation events (per-person baseline)
    │   ├── evaluate.py           # events vs GT → recall + FA/hr; --sweep grid tuning
    │   ├── wrap.py               # events → EventsFlags JSONL/CSV
    │   ├── annotate.py           # keypress GT annotation tool
    │   ├── live_monitor.py       # incremental live detector (unit-tested)
    │   ├── gaze_utils.py         # shared iris-gaze geometry
    │   ├── face_landmarker.task  # local copy (MediaPipe can't read paths with spaces)
    │   ├── .venv/                # mediapipe 1.0.1, opencv, numpy, pandas, matplotlib, pyyaml
    │   └── README.md
    ├── data/                     # Built by prep_dataset.py (re-runnable)
    │   ├── dataset.yaml          # path: data, classes 0=phone 1=person (+ test split)
    │   ├── images/{train,val,test}/ + labels/{train,val,test}/
    │   ├── _video_frames/        # staged video frames (extract_frames.py) + manifest.csv
    │   ├── exclude.txt           # duplicate stems skipped by prep (--exclude)
    │   ├── negatives_approved.txt # approved video frames used as negatives
    │   └── unlabeled_{phone,person}.txt + unannotated_review.csv
    ├── dataset/
    │   ├── image dataset/        # RAW image data — never modified
    │   │   ├── phone/            # 647 images, 603 annotated (CVAT XML)
    │   │   │   └── phoneanon/annotations.xml
    │   │   └── secondperson/     # 663 images, 632 annotated (CVAT XML)
    │   │       └── secondpersonanon/annotations.xml
    │   └── video dataset/        # Pose/gaze dataset
    │       ├── raw/              # 15 sessions: P01×6, P02×4, P03×2, P04×3
    │       ├── features/         # extract.py output CSVs
    │       ├── labels/           # GT files: <stem>_gt.csv (+ _gt_example.csv)
    │       ├── metadata.csv      # per-session info (lighting, glasses, face %, split…)
    │       └── splits.json       # person-level: train P01/P03, val P04, test P02/P06
    ├── events/                   # EventsFlags records
    │   ├── eventsflags.jsonl     # offline pipeline output (canonical)
    │   ├── eventsflags.csv       # same, for eyeballing
    │   └── live_<timestamp>.jsonl  # one file per live demo session
    └── runs/detect/              # YOLO training runs
        ├── train/                # phone-only (history)
        ├── train-2/              # first combined model (history)
        ├── train-6/              # combined, 643 images (superseded)
        ├── train-7/              # combined, 1,235 images (superseded by train-4)
        ├── train-3/              # stage-1: imgsz 960, deduped data + video negatives
        └── train-4/              # CURRENT — stage-2 fine-tune (freeze 10, lr0 0.001)
```

---

## 5. Subsystem 2 Implementation — YOLO Object & Person Detection

### 5.1 Dataset preparation (`prep_dataset.py`)

- **Sources (never modified):** both classes come from **CVAT 1.1 XML** annotations:
  - phone → `dataset/image dataset/phone/phoneanon/annotations.xml` (647 images, 603 annotated)
  - person → `dataset/image dataset/secondperson/secondpersonanon/annotations.xml` (663 images, 632 annotated)
- **CVAT parsing** (`load_cvat_xml`): pixel-corner boxes (`xtl/ytl/xbr/ybr`) → normalized YOLO center/size lines; entries with no `<box>` count as **unannotated**, not background; out-of-bounds boxes abort with an error.
- **Validation** (`check_lines`): every label line must have 5 values, source class 0, coords in [0,1] — else exit with the offending file:line.
- **Split:** per-class seeded shuffle (seed 42), 80/20 → `data/images/{train,val}` + `data/labels/{train,val}`; person class remapped 0 → 1 on write; unannotated images listed in `data/unlabeled_*.txt`.
- **Re-runnable:** output dirs are cleared first.
- **New (2026-10-28):** `--with-test` adds a held-out test split (70/15/15); `--exclude FILE` skips listed stems (`data/exclude.txt` holds 769 duplicate burst twins, keeping the earliest shot of every dhash-identical pair); staged video frames become negatives only for paths approved in `data/negatives_approved.txt` (split by person per `splits.json`); a final check fails loudly if any file name or video session spans splits, and a dhash report lists suspected cross-split near-duplicates.
- Result, original: **1,235 annotated images → 988 train / 247 val.** Result, current (deduped + negatives): **343/74/74 positives** with **715/349/471 video-frame negatives** in train/val/test.

### 5.2 Training (`train.py`)

```powershell
python train.py --preset stage1 --eval-test   # fresh: yolo11n.pt, imgsz 960, batch 8, 150 ep
python train.py --preset stage2 --eval-test   # fine-tune: train-7 best.pt, lr0 0.001, freeze 10, 50 ep
```

- CLI args `--weights/--imgsz/--batch/--epochs/--patience/--lr0/--freeze/--workers/--name` override the presets; effective args are printed and saved as `effective_args.json` in the run dir; `--eval-test` runs `val(split="test")` and saves `test_metrics.json`.
- `__main__` guard is **required on Windows** (dataloader workers re-import the module under spawn). `workers=0` default (RAM pressure), `batch 8 @ 960` ≈ old `batch 16 @ 640` in memory.

### 5.3 Model history & metrics

| Run | Data | Epochs | Result |
|-----|------|--------|--------|
| `train` | phone-only | — | superseded, kept as history |
| `train-2` | combined, ~643 img | 128 | P ≈ 0.96, R ≈ 0.95, mAP50 ≈ 0.96, mAP50-95 ≈ 0.95 |
| `train-6` | combined, 643 img (phone 358 + person 285, Roboflow) | 139 | mAP50 0.980, recall 0.976 (own val); person mAP50 0.981 (jumped from 0.637 after doubling person data). On train-7's val set: only 0.789 / 0.548 |
| `train-7` | combined, **1,235 img** (CVAT), 150 ep | 150 | **mAP50 0.980 / mAP50-95 0.760** on the 247-img val set; phone mAP50 0.970, person mAP50 0.991. Test split (leakage-reduced, 74 pos + 471 neg): P 0.959 / R 0.972 / mAP50 0.982 — partly inflated by burst neighbors. Superseded by train-4. |
| `train-3` | stage-1: yolo11n.pt @ **imgsz 960**, deduped 491 positives + 1,535 video negatives, 150 ep | 150 | Test split: P 0.928 / R 0.901 / mAP50 0.924 / mAP50-95 0.670. Video FP review (P02, /hour @0.35): phone 0, person 44.8 (2 double-box frames) |
| **`train-4`** ✅ current | stage-2: fine-tune of train-7 (freeze 10, lr0 0.001) on the train-3 dataset, 50 ep | 50 | Test split: **P 0.969 / R 0.973 / mAP50 0.971 / mAP50-95 0.781**. Video FP review (P02): phone 0/hr, person 18.7/hr @0.35 (7.5 @0.7), 0 double-box frames |

`webcam_demo.py` loads `runs/detect/train-4/weights/best.pt` (YOLO11n, ~5.5 MB); its imgsz (960) is read from the run's `args.yaml`.

### 5.4 Event mapping (live)

- Per-class confidence floors from `policy.yaml`: `yolo.conf_phone` / `yolo.conf_person` (both 0.35).
- Inference imgsz matches the loaded model's training size (read from the run's `args.yaml`).
- `phone` box → `unauthorized_object` (high); 2+ `person` boxes → `second_person` (critical).
- Debounced by `BooleanEventMonitor` (§7.2) with the policy's `min_dur_s` / `merge_gap_s`.

---

## 6. Subsystem 2 Implementation — Head-Pose & Gaze Pipeline

### 6.1 Pipeline stages

```
raw/*.mp4 → extract.py → features/<stem>_features.csv
                       → detect.py → <stem>_events.csv
                       → evaluate.py (vs labels/<stem>_gt.csv) → recall / FA/hr
                       → wrap.py → events/eventsflags.{jsonl,csv} (EventsFlags)
```

| Script | Purpose |
|---|---|
| `extract.py` | Video → per-frame features CSV: `frame_idx, t_s, face, yaw, pitch, roll, gaze_h, gaze_iris` |
| `detect.py` | Features → events, per-person **10 s baseline**; head and gaze channels detected **independently**; calibration window emits nothing; `--gaze_col` picks the channel |
| `evaluate.py` | Events vs GT → recall + false alarms/hr; `--sweep` grid-tunes on validation people only; `--policy` runs the locked tuned thresholds |
| `wrap.py` | Events → EventsFlags records (JSONL + CSV); severities and thresholds from `policy.yaml` |
| `annotate.py` | Keypress GT annotation tool |
| `live_monitor.py` | Incremental version of the detector for live sessions (unit-tested) |
| `gaze_utils.py` | Shared iris-gaze geometry |

### 6.2 Features and conventions (`extract.py`)

MediaPipe **FaceLandmarker** (IMAGE mode, `num_faces=1`, blendshapes + facial transformation matrices), one face per frame:

| Column | Meaning |
|--------|---------|
| `face` | 1 = face detected that frame; other columns NaN otherwise |
| `yaw` | + = head turned toward subject's LEFT |
| `pitch` | + = head tilted UP |
| `roll` | + = roll toward LEFT shoulder |
| `gaze_h` | blendshape gaze channel, + = looking RIGHT |
| `gaze_iris` | iris-landmark gaze channel, + = looking RIGHT |

- Euler angles from MediaPipe's 4×4 matrix with a gimbal-lock fallback (`matrix_to_euler_deg`).
- Usage: `python extract.py [--video P01_s1] [--step N] [--plot]`. Prints the face-detection ratio per video.
- The task file lives at `pose/face_landmarker.task` because **MediaPipe's C++ layer cannot read paths containing spaces** ("video dataset").

### 6.3 Detection algorithm (`detect.py`)

1. **Baseline:** median of the first `baseline_s` seconds (face==1 frames only), per video — each person's own neutral pose. Yaw and gaze baselines computed separately.
2. **Deviation:** `|yaw − baseline| ≥ head_thr` (wrap-180) or `|gaze − baseline| ≥ gaze_thr`.
3. **Channels are independent:** head and gaze run the same state machine separately — the event catalog treats them as distinct event types, and overlapping events of different types are allowed.
4. **Segmenting:** consecutive deviating frames with gaps ≤ `merge_gap` merge into one event; events shorter than `min_dur` are dropped; per-event `peak_yaw_dev` / `peak_gaze_dev` recorded.
5. **Calibration silence:** only frames with `t > baseline_s` and `face == 1` can deviate.
6. **Smoothing:** optional centered rolling mean (`smooth_s`); disabled in the shipped policy (0.0) — see §6.7.

Offline defaults (`DEFAULTS`) differ from the shipped policy: baseline 10, head_thr 15°, gaze_thr 0.25, min_dur 0.5 s, merge_gap 0.25 s, `gaze_col=gaze_h`, smooth 0.4. `wrap.py` and `evaluate.py --policy` always read `policy.yaml`.

### 6.4 Gaze channels — blendshapes vs iris

- **Blendshape channel (`gaze_h`):** combines the four eye-look blendshapes (`eyeLookOutLeft − eyeLookInLeft …`). **Rejected** — proved to be noise on every video (incl. bright, no-glasses sessions); noise floor ~0.5 swamped real events.
- **Iris channel (`gaze_iris`):** `iris_gaze_h()` in `gaze_utils.py` uses iris landmarks **468/473** against eye corners **33/133** (left outer/inner) and **362/263** (right inner/outer). Averaged pupil displacement of both eyes, sign-flipped and scaled ×4 so its range (~±2) matches the blendshape scale the thresholds expect. Separates real events ~3× from the noise floor; robust with glasses and low light. **This is the shipped channel.**

### 6.5 Annotation tool (`annotate.py`)

`python annotate.py P04_s1 [--fps_scale 0.75]` — watch the video and mark events:
`h` toggle head_pose, `g` toggle gaze, `u` undo, `n`/`b` ±5 s, `q`/Esc save. One event must be closed before opening another. Writes `labels/<stem>_gt.csv` (`event_type,start_s,end_s`). Rough timing is fine — matching uses 50 % overlap.

### 6.6 Evaluation methodology (`evaluate.py`)

- GT files `labels/<person>_<session>_gt.csv`; a detection is a true positive if it overlaps a GT event of the **same type** with **IoU ≥ 0.5** (each GT matched at most once).
- Reports recall per type and **false alarms per hour**, overall and broken down by lighting/glasses from `metadata.csv`.
- `--sweep` runs a grid (head 10–20° × gaze 0.4–0.7 × min_dur 0.5–1.0 s × merge_gap 0.5–1.0 s = 64 combos) **on validation person P04 only** — never on test. Candidates ranked by recall, then FA/hr.
- `--policy` evaluates with the locked `policy.yaml` thresholds.

### 6.7 Video dataset, splits, results

**Dataset:** 15 recorded sessions, 4 distinct humans, all 1920×1080 @ ~30 fps, face-detection rates 88–99 %.

| Split | People | Sessions | Notes |
|-------|--------|----------|-------|
| train | P01, P03 | P01_s1–s6, P03_s1–s2 | P01 = the user, both lightings/glasses states; P01_s5/s6 were P05_s1/s2 before the voiding (below) |
| val | P04 | P04_s1–s3 | another human; s1/s2 glasses (s2 also hat), s3 no glasses; P04_s3 "bright_front" cell |
| test | P02, P06 | P02_s1–s4 | another human; s1 no glasses, s2 glasses, s3/s4 no glasses; **P06 reserved — not yet recorded (must be a NEW human)** |

**Tuned policy `pose_v2`** (locked 2026-10-07, tuned on P04):

```yaml
pose:
  baseline_s: 10.0
  head_thr_deg: 12.0
  gaze_thr: 0.7
  min_dur_s: 1.0
  merge_gap_s: 0.5
  gaze_col: gaze_iris
  smooth_s: 0.0
```

**Latest recorded results** (2026-10-24):

| Set | Recall | FA/hr | Detail |
|-----|--------|-------|--------|
| Val — P04 (3 sessions) | **1.00** (4/4) | **75.0** | |
| Val — bright_front cell (P04_s3) | 1.00 | 29.3 | thresholds transfer to bright light |
| **Test — P02 (4 sessions, ~16 min)** | **0.78** (7/9) | **55.6** | both misses were sub-minimum-duration (<0.7 s) annotations |
| P02_s1 (no glasses) | 1.00 | 76.4 | |
| P02_s2 (glasses) | 0.33 | 93.2 | |
| P02_s3 / P02_s4 | 1.00 / 1.00 | ~29 each | |

**Voided result — do not cite:** the old "test person P05" was actually the user; those numbers (recall 0.40, FA/hr 75) are void. P05 videos were renamed to P01_s5/s6 (train). P02 is the legitimate test person (reslotted from train — legitimate because the pose pipeline never trains on anyone).

**Evaluated-and-rejected FA reduction** (2026-10-10, `pose_v3` candidate): temporal smoothing (0.15–0.4 s) trims FA/hr 15–35 % but costs a test match at every setting; gaze-during-head-turn suppression collapsed recall (real gaze events co-occur with head movement). Decision: shipped `pose_v2` unchanged (`smooth_s: 0.0` disables the inert code; suppression reverted). Report as "evaluated and rejected".

### 6.8 Known limit

FaceLandmarker **loses the face during large profile turns**, so dramatic full turns are undetectable. Test volunteers should make *moderate* turns that keep the face in frame.

---

## 7. Integrated Live Demo (`webcam_demo.py` + `webcam.html`)

The working prototype of the plan's client → inference pattern. One browser page, both detectors, policy-driven thresholds.

### 7.1 Server (`webcam_demo.py`)

- **FastAPI + Uvicorn** on `127.0.0.1:8000`. `GET /` serves `webcam.html`; `POST`-free WebSocket at `/ws`.
- **Models loaded at startup:** YOLO `train-4/best.pt` (GPU) and FaceLandmarker (CPU, XNNPACK).
- **Per WebSocket connection = one session** (`session_id = live_<YYYYmmdd_HHMMSS>`), a fresh `LivePoseMonitor` and two `BooleanEventMonitor`s, and a log file `events/live_<ts>.jsonl`.
- **Per frame:**
  1. `receive_bytes()` → `cv2.imdecode` the JPEG.
  2. **YOLO** `predict(conf=min(conf_phone, conf_person), imgsz=IMGSZ)`: `IMGSZ` from the model run's `args.yaml` (960 for train-4); boxes are then filtered per class by `yolo.conf_*` from `policy.yaml` (both 0.35); collects boxes `{x1,y1,x2,y2,conf,label}`; counts phones and persons.
  3. **Pose:** FaceLandmarker `detect` → `matrix_to_euler_deg` (yaw/pitch/roll) + `iris_gaze_h`. Baseline-relative angles: `yaw_dev` wrap-180 and `pitch_dev` vs the live baseline — a resting pitch (~8°) used to flip the gaze ray up/down, so the vector is baseline-relative. `compute_gaze_vector` → `{x, y, dx, dy}` for the ray. No face → `gaze: null`.
  4. **Events:** `pose_mon.update(...)` + `phone_mon.update(n_phone ≥ 1)` + `person_mon.update(n_person ≥ 2)`; finished events are persisted immediately (append to the session JSONL with `event_id`, `session_id`, `detector`, `policy_ref`).
  5. **Reply:** `{boxes, gaze, ms, state, seconds_remaining, events}` — `state` is `"calibrating"` for the first 10 s, then `"live"`; `events` carries newly *finished* events for that frame.
  6. A `cv2.error` (bad frame) sends a minimal reply so the client keeps its cadence.
- **On disconnect:** `close_session()` force-closes any open pose events and records them.
- First inference after server start includes ~1.7 s CUDA warmup.

### 7.2 Event monitor semantics

- **`BooleanEventMonitor`** (YOLO conditions): while the condition holds, records start/last timestamps; when it clears and stays clear for `merge_gap`, the event closes; emitted only if `duration ≥ min_dur`. So events are **reported on completion**, not on onset.
- **`LivePoseMonitor`** (pose): calibration collects (yaw, gaze, pitch) from face frames during the first `baseline_s`; baselines = medians; calibration **never emits events**. Afterward, head and gaze channels run independently through `_ChannelTracker`s (same open/close/min-dur/merge-gap logic, plus per-event peak deviations). Causal EMA smoothing (`alpha = dt / smooth_s`) is inert at `smooth_s = 0`.

### 7.3 Client (`webcam.html`)

- `getUserMedia` (ideal 1280×720) → hidden `<video>` → two stacked canvases: `#view` (video, **horizontally mirrored** so left/right feels natural) + `#overlay` (boxes and gaze ray).
- **Frame cadence:** 15 fps target; JPEG quality 0.7; the client **waits for the previous frame's results before drawing/sending the next** so the overlay never detaches from the head when you move.
- **Overlay:** green boxes with `label conf%`; **yellow gaze ray** from the eye-base midpoint with direction label (iris landmarks + eye corners + head orientation — relative direction, not screen-accurate); cyan eye-base marker; `gaze` ray is explicitly mirrored to match the flipped video.
- **Right panel:** calibration bar (amber → green "● Live"), severity-colored event list (low green / medium amber / high orange / critical red), status line with fps + inference ms + detection count.
- **Resilience:** WS reconnects every 1 s; camera errors shown in the status line.
- Known quirk: YOLO **boxes are drawn at unmirrored coordinates** over the mirrored video, so a detected object appears horizontally flipped relative to what you see.

### 7.4 WebSocket protocol (`/ws`) — the integration contract

- **Client → server:** binary JPEG frame, one per message (~15 fps).
- **Server → client (JSON):**

```json
{
  "boxes": [{"x1": 103, "y1": 75, "x2": 128, "y2": 87, "conf": 0.85, "label": "phone"}],
  "gaze": {"x": 0.455, "y": 0.505, "dx": 0.166, "dy": 0.157},
  "ms": 42.1,
  "state": "calibrating",
  "seconds_remaining": 7.2,
  "events": []
}
```

`gaze` is `null` when no face is in frame. The boilerplate (ingestion API, stream processor) should reproduce these message shapes.

### 7.5 How to run

```powershell
cd "C:\Users\beebadewbee\Desktop\sd3\machine learning"
python webcam_demo.py          # system Python — needs torch+ultralytics+mediapipe+fastapi
# → open http://localhost:8000, allow the camera prompt
```

1. **First 10 s:** sit still facing the camera (calibration bar).
2. Then: hold a phone → `unauthorized_object`; second person enters → `second_person`; turn head / look away → `head_pose_deviation` / `gaze_deviation`.
3. Every session persists events to `events/live_<ts>.jsonl`.
4. **Tuning = edit `policy.yaml`, restart the server** — no code changes.

---

## 8. Policy — Single Source of Truth (`machine learning/policy.yaml`)

```yaml
policy_version: pose_v2

event_catalog:
  gaze_deviation: medium
  head_pose_deviation: medium
  second_voice: high
  unauthorized_object: high
  second_person: critical
  focus_loss: medium
  copy_paste: low
  connectivity_interruption: low

pose:
  baseline_s: 10.0
  head_thr_deg: 12.0
  gaze_thr: 0.7
  min_dur_s: 1.0
  merge_gap_s: 0.5
  gaze_col: gaze_iris
  smooth_s: 0.0        # FA-reduction experiment: evaluated and rejected

yolo:
  conf_phone: 0.35     # per-class confidence floors for the live demo
  conf_person: 0.35
```

The Stream Processor must read this file, not hardcode values.

---

## 9. EventsFlags Schema — DB Contract

Every event in the system, live and offline, has this shape (JSONL, one per line):

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

- `detector`: `"pose_mediapipe"` for pose/gaze events, `"yolo11n"` for object/person events.
- `event_id`: `live_<ts>-NNNN` (live) or `<stem>-NNNN` (offline).
- `policy_ref` records which policy version produced the event (traceability).
- Offline records come from `wrap.py` → `events/eventsflags.jsonl` (+ `.csv`); live records from `webcam_demo.py` → `events/live_<ts>.jsonl`.
- The team's `EventsFlags` DB table should mirror these field names 1:1 (keep `session_id`, `start_s`/`end_s`, `detector`, `policy_ref`).

---

## 10. Environments & Dependencies

### 10.1 System Python (ML training + live demo)

Verified working 2026-10-27: `torch 2.14.1+cu126` (CUDA available), `ultralytics`, `opencv-python`, `fastapi`, `uvicorn`, `mediapipe`. (The original install was torch 2.11.0+cu128 from the official PyTorch index to get past Windows Smart App Control blocking cu126 DLLs with WinError 4551; the version has since been updated — installs must keep using `https://download.pytorch.org/whl/cu128`-style official wheels if SAC blocks again.)

`requirements.txt` lists only `ultralytics`, `opencv-python`, `fastapi`, `uvicorn` — **incomplete**: torch and mediapipe were installed manually.

### 10.2 `pose/.venv` (offline pose pipeline)

`pose/.venv` has mediapipe 1.0.1, opencv, numpy, pandas, matplotlib, pyyaml — **no ultralytics/fastapi/torch**, so `webcam_demo.py` and `train.py` run on system Python, while the offline pipeline runs from the venv:

```powershell
cd "C:\Users\beebadewbee\Desktop\sd3\machine learning\pose"
.\.venv\Scripts\Activate.ps1
python extract.py     # videos → features
python detect.py      # features → events
python evaluate.py    # events → recall / FA/hr (--sweep, --policy)
python wrap.py        # events → events/eventsflags.jsonl
```

### 10.3 Windows gotchas (learned the hard way)

- `__main__` guard required in `train.py` and `webcam_demo.py` — multiprocessing spawn re-imports the module.
- `dataset.yaml`'s `path` resolves **from the cwd** — always run training from `machine learning/`.
- **RAM pressure kills dataloader workers** (WinError 1455 / bad allocation) whenever the laptop hasn't been restarted in days → `workers=0`. After a fresh restart `batch=32, workers=2` is safe and ~2× faster.
- `yolo26n.pt` reappears after every training run (AMP check) — safe to delete.
- MediaPipe cannot read task-file paths with spaces → `face_landmarker.task` lives in `pose/`.
- First torch import after a fresh install is slow (Defender scan); later imports fast.
- ~1.7 s CUDA warmup on the first inference after server start.

---

## 11. Project Plan (PROJECT_PLAN.md)

### 11.1 Milestones (12 weeks)

| Weeks | Milestone |
|-------|-----------|
| Done | SRS v1.2 and SDD v1.0 (+ v01.01 addendum) baselines |
| 1–4 | Core monitoring pipeline: client, CV/ML services, ingestion API, stream processor |
| 3–5 | Storage layer and retention job |
| 5–6 | LLM summarization integrated and traceability-validated |
| 6–8 | Proctor dashboard, review workflow, recording export, guarded DB viewer |
| 7–9 | User/account management and exam management |
| 9–10 | Reporting and compliance service |
| 10–11 | Integration, performance, and compliance testing |
| 12 | Pilot deployment, documentation, final defense |

### 11.2 Key dependencies

- Stream processor needs the ingestion API and queue first.
- LLM service needs a stable `EventsFlags` schema.
- Dashboard needs the stream processor and the LLM service.
- Recording export needs object storage, presigned URLs, and populated `Recordings` rows.
- DB viewer needs RBAC and a working `AuditLog`.
- Reporting needs `RiskScores`, `SessionSummaries`, and `AuditLog` populated.

### 11.3 Deployment & pilot gates

Dev → Staging → Pilot (small, consenting class) → Production.

**Pilot gates:** consent management and retention verified operational; DB viewer verified to restrict deletion to the test Institution (deny + log everything else); presigned URLs verified for expiry, scoping, and audit logging.

### 11.4 Quality assurance

Unit tests for CV/ML and pipeline components; integration tests across client → ingestion → processor → storage → dashboard; UAT of review workflow/export/DB viewer; verification passes that summaries contain no unsupported statements; negative tests that unauthorized delete/export attempts are denied and logged; confirmation that the live view stays undeployed.

### 11.5 Change control

Submit a change request, assess impact against the SRS/SDD, get adviser approval, record in a new revision.

### 11.6 Top risks (SPMP risk log)

| Risk | L/I | Mitigation |
|------|-----|------------|
| False positives harm students | Med/High | Thresholds, fusion, mandatory human review |
| LLM summary contains unsupported statements | Med/High | Traceability validation before storage |
| Team can't finish all 10 subsystems | Med/High | Core pipeline first; change control |
| Live-view scope creep | Med/Med | Explicitly deferred; unscheduled |
| Model bias (accents, lighting) | Med/Med | Diverse training data; monitor flag-rate disparities |
| Deletion tool hits production data | Low/High | Role gating, test-institution check, confirmation, audit log |
| Recording export exposes media | Low/High | Short-lived URLs, role/institution checks, audit log |
| FERPA/GDPR non-compliance | Low/High | Encryption, consent, minimization, retention |

---

## 12. Honest Gaps & Next Steps

**Done since 2026-10-27:** duplicate burst twins excluded (769 images, dhash-identical pairs), held-out test split added (70/15/15), 1,535 video-domain frames approved as negatives (split by person), stage-1 (`train-3`, imgsz 960) and stage-2 fine-tune (`train-4`) trained, and an FP-review tool (`eval_fp.py`) comparing coco/train-7/train-3/train-4 on video frames. Shipped: train-4.

**Not started:** audio (`second_voice`), browser behavior (`focus_loss`, `copy_paste`), connectivity events, ingestion API + queue, stream processor + `RiskScores`, database, LLM summarizer, dashboard, accounts, exam management, reporting, retention job.

**Known limits:**

- Pose events fire only when the face stays trackable (large profile turns undetectable).
- Pose test numbers are small-n (one test person, 4 sessions) — indicative, not conclusive.
- Live events persist as JSONL files, not a DB.
- Notes/textbook object classes: datasets exist in the plan, not yet trained (the YOLO pipeline is repeatable per class).
- P06 (second test person) not recorded — recommended in `bright_front` lighting.
- GT windows in the video dataset were drawn wider than the actual deviations (~4 s windows around ~1.5 s events) — affects FA/hr readings.
- `webcam.html` draws YOLO boxes unmirrored over the mirrored video feed (visual offset only).
- Audio + browser + network events will need their own debounce/monitor code mirroring `BooleanEventMonitor`/`_ChannelTracker`.

**Stale artifacts worth cleaning/fixing before submission:**

1. `labels/P05_s1_gt.csv` + `P05_s2_gt.csv` remain on disk although P05 was voided and renamed to P01_s5/s6.
2. `machine learning/README.md` still calls `train-2` the current model and lists old image counts (414/151) — `train-4` is current.
3. `ML_HANDOFF.md` §2.1 still describes `train-6` as the current model.
4. `requirements.txt` is missing torch and mediapipe.
5. `yolo26n.pt` reappears after every training run (AMP check) — safe to delete.

**Source-document inconsistencies to fix (PROJECT_PLAN.md §6):**

1. Version labels conflict (SRS "v01.00" vs "v1.2"; SDD header vs text).
2. Revision dates out of order (SRS/SDD entries predate header dates; SPMP entry 09/12 vs header 09/26).
3. SRS gap: SDD-1.1–2.2 (recording export, DB viewer, delete ops) have no SRS parent — back-port for clean traceability.
4. SDD/SPMP baseline wording consistency.
5. Possible minimization gap: the LLM receives `student_id` (an identifier) — consider pseudonymizing.
