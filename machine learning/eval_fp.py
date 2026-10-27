"""Review candidate false positives of YOLO models over staged video frames.

No object ground truth exists for these videos, so the "FP rate" here is the
candidate detection rate per hour of video at each confidence step (0.35–0.7);
the saved annotated frames are the evidence for manual review. Video time is
approximated as frames x --interval.

Models: "coco" (stock yolo11n.pt; COCO ids 67 phone / 0 person), "train-7",
or any weights path. imgsz is read from each run's args.yaml (fallback 640).

Usage:
    python eval_fp.py --split test --models coco train-7
    python eval_fp.py --split test --sessions P02_s1 --models coco train-7 runs/detect/train8/weights/best.pt
"""
import argparse
import csv
import json
import shutil
from pathlib import Path

import cv2
import yaml
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
STAGING = ROOT / "data" / "_video_frames"
OUT = ROOT / "runs" / "fp_review"
CONF_STEPS = (0.35, 0.5, 0.6, 0.7)
SAVE_CONF = 0.35
PRESETS = {"coco": "yolo11n.pt", "train-7": "runs/detect/train-7/weights/best.pt"}
COCO_CLASSES = {67: "phone", 0: "person"}


def model_imgsz(weights: Path) -> int:
    """imgsz the model was trained at, from the run's args.yaml (fallback 640)."""
    try:
        cfg = yaml.safe_load((weights.parents[1] / "args.yaml").read_text(encoding="utf-8"))
        return int(cfg["imgsz"])
    except Exception:
        return 640


def resolve(spec: str) -> Path:
    """'train-4' or a weights path -> the weights file (bare run names resolve under runs/detect/)."""
    p = Path(spec)
    if not p.exists():
        alt = ROOT / "runs" / "detect" / spec / "weights" / "best.pt"
        if alt.exists():
            return alt
    return p


def run_one(spec: str, frames: list[Path], interval: float) -> None:
    is_coco = spec == "coco"
    if is_coco:
        weights, name = Path(PRESETS["coco"]), "coco"
    elif spec in PRESETS:
        weights, name = Path(PRESETS[spec]), spec
    else:
        weights = resolve(spec)
        # runs/detect/<run>/weights/best.pt -> name by run dir, not "best"
        name = weights.parents[1].name if weights.parent.name == "weights" else weights.stem
    imgsz = model_imgsz(weights)
    hours = len(frames) * interval / 3600.0
    print(f"\n[{name}] {len(frames)} frames ~ {hours:.2f} h video, imgsz {imgsz}")
    model = YOLO(str(weights))

    out_dir = OUT / name
    if out_dir.exists():
        shutil.rmtree(out_dir)  # review output is re-runnable
    out_dir.mkdir(parents=True)

    dets = []
    for f in frames:
        results = model.predict(str(f), imgsz=imgsz, conf=0.25, verbose=False)
        r = results[0]
        person, session = f.parent.parent.name, f.parent.name
        for box in r.boxes:
            cls = int(box.cls[0])
            label = COCO_CLASSES.get(cls) if is_coco else r.names[cls]
            if label is None:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            dets.append({"frame": f.name, "person": person, "session": session,
                         "class": label, "conf": float(box.conf[0]),
                         "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                         "w": round(x2 - x1, 1), "h": round(y2 - y1, 1)})

    # annotated frames grouped by class (one file per class present in a frame)
    by_frame: dict[tuple, list[dict]] = {}
    for d in dets:
        if d["conf"] >= SAVE_CONF:
            by_frame.setdefault((d["person"], d["session"], d["frame"]), []).append(d)
    for (person, session, stem), ds in by_frame.items():
        img = cv2.imread(str(STAGING / person / session / stem))
        for d in ds:
            color = (0, 140, 255) if d["class"] == "phone" else (0, 255, 0)
            cv2.rectangle(img, (int(d["x1"]), int(d["y1"])), (int(d["x2"]), int(d["y2"])), color, 2)
            cv2.putText(img, f"{d['class']} {d['conf']:.2f}", (int(d["x1"]), max(20, int(d["y1"]) - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        for d in ds:
            sub = out_dir / d["class"]
            sub.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(sub / f"{d['conf']:.3f}_{person}_{session}_{stem}"), img)

    with open(out_dir / "detections.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["frame", "person", "session", "class", "conf", "w", "h"])
        w.writeheader()
        for d in sorted(dets, key=lambda d: -d["conf"]):
            w.writerow({k: d[k] for k in w.fieldnames})

    rows = []
    print(f"  candidate detections/hour per conf step (hours = {hours:.2f}):")
    print("  " + f"{'class':<7}" + "".join(f"{c:>9.2f}" for c in CONF_STEPS))
    for cls in ("phone", "person"):
        line = []
        for c in CONF_STEPS:
            n = sum(1 for d in dets if d["class"] == cls and d["conf"] >= c)
            per_h = n / hours if hours else 0.0
            line.append(per_h)
            rows.append({"class": cls, "conf": c, "count": n, "per_hour": round(per_h, 1)})
        print("  " + f"{cls:<7}" + "".join(f"{v:>9.1f}" for v in line))
    with open(out_dir / "summary.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["class", "conf", "count", "per_hour"])
        w.writeheader()
        w.writerows(rows)
    print(f"  review images + CSV: {out_dir}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--split", default="test", choices=["train", "val", "test"])
    ap.add_argument("--sessions", help="comma-separated filter, e.g. P02_s1,P02_s2")
    ap.add_argument("--models", nargs="+", default=["coco", "train-7"])
    ap.add_argument("--interval", type=float, default=2.0,
                    help="seconds per staged frame (matches extract_frames.py)")
    args = ap.parse_args()

    if not STAGING.exists() or not any(STAGING.glob("*/*/*.jpg")):
        raise SystemExit(f"no staged frames in {STAGING} — run extract_frames.py first")
    splits = json.loads((ROOT / "dataset" / "video dataset" / "splits.json").read_text(encoding="utf-8"))
    persons = set(splits[args.split])
    want = set(args.sessions.split(",")) if args.sessions else None
    frames = sorted(f for f in STAGING.glob("*/*/*.jpg")
                    if f.parent.parent.name in persons
                    and (want is None or f"{f.parent.parent.name}_{f.parent.name}" in want))
    if not frames:
        raise SystemExit(f"split {args.split}: no staged frames matching {args.sessions or 'any session'}")
    print(f"split {args.split}: {len(frames)} frames "
          f"({sorted(f.parent.parent.name for f in frames[:1])[0]} domain, sessions {sorted(set(f.parent.name for f in frames))})")
    for spec in args.models:
        run_one(spec, frames, args.interval)


if __name__ == "__main__":
    main()
