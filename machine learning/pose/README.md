# Head-Pose & Gaze Workstream (MediaPipe) — Phase D

Feeds the plan's Head-Pose Deviation (Medium) and Gaze Deviation (Medium) events.
Pipeline: videos → `extract.py` (features CSV) → `detect.py` (events, per-person
baseline = first 10 s) → `evaluate.py` (recall + false alarms/hr).

## Setup

```powershell
cd "C:\Users\beebadewbee\Desktop\sd3\machine learning\pose"
.\.venv\Scripts\Activate.ps1        # venv with mediapipe, opencv, numpy, pandas, matplotlib
```

## Workflow (your Phase D process)

1. **Test on one video:** `python extract.py --video P01_s1 --plot` → open
   `..\dataset\video dataset\features\P01_s1_plot.png` (yaw / pitch / gaze_h vs time).
   Check the lines move when you turn/look away, and that `face` ≈ 1 for almost
   every frame (extract.py prints the ratio). If the face keeps getting lost, fix
   lighting/camera position before recording more.
2. **Extract all:** `python extract.py` (one CSV per video in raw/).
3. **Detect:** `python detect.py` → `*_events.csv`. Thresholds via flags
   (`--head_thr`, `--gaze_thr`, `--min_dur`, `--baseline_s`, `--merge_gap`).
4. **Evaluate:** add ground-truth files `labels/<person>_<session>_gt.csv`
   (columns `event_type,start_s,end_s`), then `python evaluate.py`.
5. **Tune on validation people only:** `python evaluate.py --sweep` (uses P04).
6. **Final run on test people** (P05/P06): fix the best thresholds in
   `detect.py` DEFAULTS, run once, report the lighting/glasses breakdown.
7. **Wrap for the pipeline (done):** `python wrap.py` reads `../policy.yaml`
   (severity catalog + pose thresholds) and writes EventsFlags records to
   `../events/eventsflags.jsonl` (+ `.csv` for eyeballing). After the P04
   sweep, update the thresholds in `policy.yaml` — no code changes. Events
   inside the baseline window are excluded (calibration emits nothing).

## Conventions

- `yaw` + = head to subject's LEFT; `pitch` + = up; `roll` + = left shoulder;
  `gaze_h` + = looking RIGHT (verified on P01_s1).
- `face=1` means a face was detected that frame; `detect.py` only counts
  deviating frames where `face=1`.
- `metadata.csv` is canonical per-video info (rows pre-filled for P02–P06 with
  TBDs — fill `lighting, glasses, camera, resolution, fps, background, framing`
  after each recording).
- `splits.json` is person-level: train P01–P03, val P04, test P05–P06.

## Adding a video

1. Drop `raw/<person>_<session>.mp4` (stem must match metadata/splits).
2. Fill the TBD columns in that video's `metadata.csv` row.
3. Val/test people only: write `labels/<stem>_gt.csv` (see `_gt_example.csv` for
   the format — header `event_type,start_s,end_s`, one row per real deviation).
4. Run `python extract.py` (all videos) then `python detect.py`.
