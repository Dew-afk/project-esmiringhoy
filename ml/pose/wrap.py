"""Phase D step 7 — wrap pose events into EventsFlags format.

Reads policy.yaml (severity catalog + pose thresholds), runs the detector on
every features CSV, and emits one record per event in two forms:

    ../events/eventsflags.jsonl  (canonical, machine-readable)
    ../events/eventsflags.csv    (convenience, for eyeballing in Excel)

Record shape (JSONL):
    {"event_id": "P01_s1-0003", "session_id": "P01_s1",
     "event_type": "gaze_deviation", "severity": "medium",
     "start_s": 45.5, "end_s": 47.2, "duration_s": 1.7,
     "peak_yaw_dev": 4.2, "peak_gaze_dev": 0.61,
     "detector": "pose_mediapipe", "policy_ref": "pose_v1"}

Usage (venv activated, from pose/):
    python wrap.py                   # all features CSVs
    python wrap.py --stems P01_s1 P02_s1
"""
import argparse
import csv
import json
import sys
from pathlib import Path

import yaml

from detect import detect_events, load_features

ROOT = Path(__file__).resolve().parent
ML_ROOT = ROOT.parent
POLICY_PATH = ML_ROOT / "policy.yaml"
FEAT_DIR = ROOT.parent / "dataset" / "video dataset" / "features"
EVENT_DIR = ML_ROOT / "events"

EVENT_TYPE_MAP = {"head_pose": "head_pose_deviation", "gaze": "gaze_deviation"}


def load_policy() -> dict:
    if not POLICY_PATH.exists():
        sys.exit(f"missing {POLICY_PATH}")
    with open(POLICY_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def pose_params(policy: dict) -> dict:
    p = policy["pose"]
    return {
        "baseline_s": float(p["baseline_s"]),
        "head_thr": float(p["head_thr_deg"]),
        "gaze_thr": float(p["gaze_thr"]),
        "min_dur": float(p["min_dur_s"]),
        "merge_gap": float(p["merge_gap_s"]),
        "gaze_col": p.get("gaze_col", "gaze_h"),
        "smooth_s": float(p.get("smooth_s", 0.4)),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stems", nargs="*", help="session stems; default: all features CSVs")
    args = ap.parse_args()

    policy = load_policy()
    params = pose_params(policy)
    catalog = policy["event_catalog"]
    print(f"policy {policy['policy_version']} | thresholds: head {params['head_thr']} deg | "
          f"gaze {params['gaze_thr']} | min_dur {params['min_dur']} s")

    files = [FEAT_DIR / f"{s}_features.csv" for s in args.stems] if args.stems \
        else sorted(FEAT_DIR.glob("*_features.csv"))
    if not files:
        sys.exit("no features CSVs found — run extract.py first")

    EVENT_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = EVENT_DIR / "eventsflags.jsonl"
    csv_path = EVENT_DIR / "eventsflags.csv"
    fieldnames = ["event_id", "session_id", "event_type", "severity", "start_s",
                  "end_s", "duration_s", "peak_yaw_dev", "peak_gaze_dev",
                  "detector", "policy_ref"]

    with open(jsonl_path, "w", encoding="utf-8", newline="") as jf, \
         open(csv_path, "w", encoding="utf-8", newline="") as cf:
        writer = csv.DictWriter(cf, fieldnames=fieldnames)
        writer.writeheader()
        total = 0
        for feat in files:
            if not feat.exists():
                print(f"  skip {feat.name}: not found")
                continue
            stem = feat.stem.replace("_features", "")
            events = detect_events(load_features(feat), params)
            for i, ev in events.iterrows():
                etype = EVENT_TYPE_MAP.get(ev["event_type"], ev["event_type"])
                record = {
                    "event_id": f"{stem}-{i + 1:04d}",
                    "session_id": stem,
                    "event_type": etype,
                    "severity": catalog.get(etype, "medium"),
                    "start_s": ev["start_s"],
                    "end_s": ev["end_s"],
                    "duration_s": ev["duration_s"],
                    "peak_yaw_dev": ev["peak_yaw_dev"],
                    "peak_gaze_dev": ev["peak_gaze_dev"],
                    "detector": "pose_mediapipe",
                    "policy_ref": policy["policy_version"],
                }
                jf.write(json.dumps(record) + "\n")
                writer.writerow(record)
                total += 1
            print(f"  {stem}: {len(events)} events")

    print(f"wrote {total} EventsFlags records -> {jsonl_path.relative_to(ML_ROOT)}")


if __name__ == "__main__":
    main()
