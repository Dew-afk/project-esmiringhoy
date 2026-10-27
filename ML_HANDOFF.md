# ML & MediaPipe — Progress Handoff for Integration

*Prepared 2026-10-04, updated 2026-10-07 (pose pipeline TUNED and TESTED — see §3.4 and §4; YOLO retrained with doubled person data — see §2.1). Partner-facing summary of the CV/ML workstream. See `PROJECT_PLAN.md` for the full architecture.*

## 1. Scope of this part

My part covers the two vision/ML workstreams and makes them **integration-ready**: the YOLO object/person detector, the MediaPipe head-pose/gaze pipeline, and the live webcam demo that consumes both. Everything here is structured so the rest of the team can build the Ingestion API, Stream Processor, and data layer against it **without touching ML code**.

## 2. What's done

### 2.1 YOLO object & person detection

- **One combined model** — `machine learning/runs/detect/train-6/weights/best.pt` (YOLO11n, 5.5 MB, PyTorch)
- Classes: `0 = phone`, `1 = person`
- Trained on 643 labeled images (phone 358 + person 285, both Roboflow-exported), 139 epochs on the RTX 4060
- Validation: overall mAP50 **0.980**, recall **0.976** — per class: phone mAP50 0.979, **person mAP50 0.981** (the person class jumped from 0.637 after doubling its data)
- Dataset prep: `prep_dataset.py` (validates labels, remaps class ids, seeded 80/20 split → `data/images/{train,val}` + `data/labels/{train,val}`); raw data lives in `dataset/image dataset/`
- **Event mapping:** a `phone` box → `unauthorized_object` (severity high); 2+ `person` boxes → `second_person` (critical)

### 2.2 MediaPipe head-pose & gaze pipeline

All in `machine learning/pose/` (own venv at `pose/.venv`, mediapipe 1.0.1):

| Script | Purpose |
|---|---|
| `extract.py` | Video → per-frame features CSV: `frame_idx, t_s, face, yaw, pitch, roll, gaze_h, gaze_iris` |
| `detect.py` | Features → events, per-person **10 s baseline**; calibration window emits nothing; head and gaze channels detected **independently**; `--gaze_col` picks the channel |
| `evaluate.py` | Events vs ground truth → recall + false alarms/hr; `--sweep` grid-tunes on validation people only; `--policy` runs the locked tuned thresholds |
| `wrap.py` | Events → **EventsFlags records** (JSONL + CSV), severities and thresholds from `policy.yaml` |
| `annotate.py` | Keypress ground-truth annotation tool (h/g toggle, u undo, q save) |
| `live_monitor.py` | Incremental version of the detector for live webcam sessions (unit-tested, independent channels) |
| `gaze_utils.py` | Shared iris-gaze geometry (`iris_gaze_h` for events, `compute_gaze_vector` for the live gaze ray) |

**Gaze channel:** the pipeline uses **iris landmarks** (`gaze_iris`), not the blendshape scores — the blendshapes proved to be noise on every video (incl. bright, no-glasses sessions), while iris geometry separates real events ~3× from the noise floor.

Video dataset at `dataset/video dataset/`: train P01 (user, s1–s6, both lightings/glasses states) + P03 (new human, s1–s2); validation P04 (new human, s1–s3, dim + bright); test P02 (new human, s1–s2, bright, with and without glasses) + P06 (reserved). 14 sessions, 4 distinct humans; face-detection rates 88–99%.

### 2.3 Integrated live demo (the integration reference)

- `machine learning/webcam_demo.py` — FastAPI server running **both detectors per frame**: YOLO on GPU, FaceLandmarker on CPU
- `machine learning/webcam.html` — browser client: camera feed, detection boxes, **live gaze ray**, 10-second calibration bar, severity-colored event panel
- Every session persists its events to `events/live_<timestamp>.jsonl`
- **This demo is the working prototype of the plan's client → inference pattern** — the boilerplate you build should reproduce its message shapes.

## 3. Integration contract (build against this)

### 3.1 WebSocket protocol (`/ws`)

**Client → server:** binary JPEG frame (one per message, ~15 fps)

**Server → client (JSON):**

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

`gaze` is `null` when no face is in frame; `state` is `"calibrating"` for the first 10 s, then `"live"`; `events` carries newly finished events for that frame.

### 3.2 EventsFlags record schema (what your DB table should mirror)

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

`detector` is `"pose_mediapipe"` for pose/gaze events and `"yolo11n"` for object/person events.

### 3.3 Event types & severities (from `policy.yaml`)

| Event type | Severity | Source (current status) |
|---|---|---|
| `gaze_deviation` | medium | ✅ MediaPipe live + offline |
| `head_pose_deviation` | medium | ✅ MediaPipe live + offline |
| `unauthorized_object` | high | ✅ YOLO live (phone class) |
| `second_person` | critical | ✅ YOLO live (2+ person boxes) |
| `second_voice` | high | ⏳ audio workstream — not started |
| `focus_loss` | medium | ⏳ browser behavior — your part |
| `copy_paste` | low | ⏳ browser behavior — your part |
| `connectivity_interruption` | low | ⏳ network — your part |

### 3.4 Policy config

`machine learning/policy.yaml` is the single source of truth: the severity catalog above plus the pose thresholds. Current version **pose_v2** (tuned 2026-10-07 on validation person P04, then run once on test person P05):

```yaml
pose:
  baseline_s: 10.0
  head_thr_deg: 12.0
  gaze_thr: 0.7
  min_dur_s: 1.0
  merge_gap_s: 0.5
  gaze_col: gaze_iris
```

**The Stream Processor should read this file, not hardcode values** — tuning = editing this YAML, nothing else.

## 4. Current status (honest)

- **Pose pipeline: TUNED and TESTED.** Tuned on validation P04 (recall 1.00, FA/hr 75 across sessions) and evaluated once on test person P02 with locked thresholds: **recall 0.78 (7/9), FA/hr 55.6** across 4 sessions (~16 min). Both misses are sub-minimum-duration (<0.7 s) annotations. Small n; treat as indicative. (Note: an earlier "test" round on a mislabeled person was voided — P02 is the valid test result.)
- **Known limit:** FaceLandmarker loses the face during large profile turns, so dramatic full turns are undetectable — brief test volunteers to make *moderate* turns that keep the face in frame.
- Notes / textbook object classes: datasets exist in plan, not yet trained — the YOLO pipeline above is repeatable per class.
- Audio (second voice) workstream: not started.
- P06 (second test person) not yet recorded — recommended in `bright_front` lighting to widen the breakdown matrix.
- Live session events are persisted as JSONL, not yet into a DB — that's your layer's job.

## 5. Suggested integration surface for the boilerplate

1. **Ingestion API** that accepts these EventsFlags JSON objects (exact schema in §3.2) and forwards to the queue — the live demo already produces them.
2. **EventsFlags table** matching the JSON field names 1:1 (keep `session_id`, `start_s/end_s`, `detector`, `policy_ref`).
3. **Stream Processor** that consumes from the queue and applies the §3.3 severity map + `policy.yaml` thresholds to compute `RiskScores`.
4. **Client layer** can reuse `webcam.html`'s frame-sending logic verbatim (canvas → JPEG → WebSocket).

## 6. Quick-start (if you want to run anything)

```powershell
# live demo (everything at once)
cd "C:\Users\beebadewbee\Desktop\sd3\machine learning"
python webcam_demo.py        # → http://localhost:8000

# offline pose pipeline
cd pose
.\.venv\Scripts\Activate.ps1
python extract.py            # videos → features
python detect.py             # features → events
python wrap.py               # events → EventsFlags (events/eventsflags.jsonl)
```
