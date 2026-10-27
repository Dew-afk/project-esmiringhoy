# Machine Learning — Training Workspace

This folder is the ML training workspace for the proctoring project (subsystem 2 of `PROJECT_PLAN.md`: CV/ML Inference — object/person detection, head-pose, gaze, audio).

## Stack

- [Ultralytics YOLO](https://docs.ultralytics.com/) (YOLO11) for object & person detection
- PyTorch backend, trained on the local GPU (RTX 4060 Laptop, 8 GB)

## Layout

```
machine learning/
├── train.py              # training entry point (phone + person dataset)
├── prep_dataset.py       # dataset prep: split + copy into data/ (re-runnable)
├── requirements.txt
├── dataset/image dataset/phone/        # RAW — never modified (414 images, 1920x1080)
│   └── phone annoated/                 #   Roboflow-style export: labels/train/phone - Copy/*.txt
├── dataset/image dataset/secondperson/ # RAW — never modified (151 images)
│   └── secondpersonA/                  #   Roboflow-style export: labels/train/secondperson/*.txt
└── data/
    ├── dataset.yaml      # classes: 0 = phone, 1 = person
    ├── images/{train,val}/   # built by prep_dataset.py
    ├── labels/{train,val}/   # built by prep_dataset.py (person remapped 0 -> 1)
    └── unlabeled_phone.txt / unlabeled_person.txt  # excluded from training
```

## Dataset workflow (phone + person, one combined model)

1. **Prep:** `python prep_dataset.py` — validates every label (class 0 in source,
   coords in [0,1]), remaps person labels to class 1, splits each class 80/20
   (seed 42) into `data/`, and lists unannotated images in `data/unlabeled_*.txt`.
   Annotate those and re-run this step to include them.
2. **Train:** `python train.py` — results go to `runs/detect/train*/`.
3. **Validate:** `yolo val model=runs/detect/train-2/weights/best.pt data=data/dataset.yaml`
4. **Try it:** `yolo predict model=runs/detect/train-2/weights/best.pt source=dataset/secondperson/WIN_20261002_22_44_34_Pro.jpg`

**Current model:** `runs/detect/train-2/weights/best.pt` (combined phone+person,
trained 2026-10-03, 128 epochs) — final-epoch P ≈ 0.96, R ≈ 0.95, mAP50 ≈ 0.96,
mAP50-95 ≈ 0.95. Supersedes the phone-only model (whose run at `runs/detect/train/`
is kept as history). `yolo11n.pt` is the pretrained base for future training runs
(notes/textbook classes next).

## Webcam demo — integrated live proctoring

One browser page, both detectors, policy-driven thresholds:

1. `python webcam_demo.py` — starts the FastAPI server (YOLO on GPU,
   FaceLandmarker on CPU, thresholds from `policy.yaml`)
2. Open `http://localhost:8000` and allow the camera permission prompt
3. **First 10 s:** sit still facing the camera — the page shows a calibration
   bar (per-session pose baseline)
4. After that, live events stream into the right-hand panel:
   - hold a phone → `unauthorized_object` (high)
   - a second person enters → `second_person` (critical)
   - turn your head / look away → `head_pose_deviation` / `gaze_deviation` (medium)

Server: `webcam_demo.py` (FastAPI + WebSocket at `/ws`, receives JPEG frames,
returns boxes + calibration state + new events). Page: `webcam.html`.
Pose logic: `pose/live_monitor.py` (incremental version of `pose/detect.py`).
A yellow **gaze ray** overlaid on the video shows where the eyes are looking
(iris landmarks + eye corners + head orientation; relative direction, not
screen-accurate). Every session persists its events to
`events/live_<ts>.jsonl` (EventsFlags format). **Tuning = edit `policy.yaml`,
restart the server** — no code changes.

Swap `yolo11n.pt` for `yolo11s/m/l/x.pt` in `train.py` if you want more capacity.
