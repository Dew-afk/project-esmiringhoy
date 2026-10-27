"""Phase D — evaluate detected events against ground truth.

Ground truth format (one file per person-session in labels/):
    <person>_<session>_gt.csv  with columns: event_type,start_s,end_s
Example: labels/P04_s1_gt.csv

Matching: a detected event counts as a true positive if it overlaps a GT event
of the same type with IoU >= 0.5. Reports recall per type and false alarms per
hour, overall and broken down by lighting/glasses from metadata.csv.

Usage:
    python evaluate.py                              # current thresholds, all people
    python evaluate.py --sweep                      # grid search on VAL people only
"""
import argparse
import itertools
import sys
from pathlib import Path

import pandas as pd

from detect import DEFAULTS, detect_events, load_features

ROOT = Path(__file__).resolve().parent
DATASET = ROOT.parent / "dataset" / "video dataset"
FEAT_DIR = DATASET / "features"
LABEL_DIR = DATASET / "labels"
META = DATASET / "metadata.csv"
IOU = 0.5


def iou(a_start, a_end, b_start, b_end) -> float:
    inter = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    union = (a_end - a_start) + (b_end - b_start) - inter
    return inter / union if union > 0 else 0.0


def load_people() -> pd.DataFrame:
    meta = pd.read_csv(META)
    meta["stem"] = meta["person_id"] + "_" + meta["session"]
    return meta


def evaluate(params: dict, stems: list[str] | None = None) -> pd.DataFrame:
    meta = load_people()
    if stems:
        meta = meta[meta["stem"].isin(stems)]
    rows = []
    for _, m in meta.iterrows():
        stem = m["stem"]
        feat, gt = FEAT_DIR / f"{stem}_features.csv", LABEL_DIR / f"{stem}_gt.csv"
        if not feat.exists():
            print(f"  skip {stem}: no features (run extract.py)")
            continue
        if not gt.exists():
            print(f"  skip {stem}: no ground truth (expected {gt.name} in labels/)")
            continue
        det = detect_events(load_features(feat), params)
        gt_df = pd.read_csv(gt)
        matched, fa = 0, len(det)
        for _, g in gt_df.iterrows():
            for _, d in det[det["event_type"] == g["event_type"]].iterrows():
                if iou(d["start_s"], d["end_s"], g["start_s"], g["end_s"]) >= IOU:
                    matched += 1
                    fa -= 1
                    break
        hours = load_features(feat)["t_s"].iloc[-1] / 3600
        rows.append({
            "stem": stem, "lighting": m["lighting"], "glasses": m["glasses"],
            "gt": len(gt_df), "tp": matched, "fp": fa, "hours": round(hours, 2),
            "recall": matched / len(gt_df) if len(gt_df) else float("nan"),
            "fa_per_hour": round(fa / hours, 2) if hours else float("nan"),
        })
    return pd.DataFrame(rows)


def sweep(gaze_col: str) -> None:
    """Threshold grid on VAL people only — tune here, never on test."""
    meta = load_people()
    val_stems = meta[meta["stem"].str.startswith("P04")]["stem"].tolist()
    if not val_stems:
        sys.exit("no validation people found (P04) — tune only when their data exists")
    print(f"sweep on validation stems: {val_stems} | gaze channel: {gaze_col}\n")

    results = []
    for head_thr, gaze_thr, min_dur, merge_gap in itertools.product(
            [10.0, 12.0, 15.0, 20.0], [0.4, 0.5, 0.6, 0.7], [0.5, 1.0], [0.5, 1.0]):
        params = dict(DEFAULTS, head_thr=head_thr, gaze_thr=gaze_thr, min_dur=min_dur,
                      merge_gap=merge_gap, gaze_col=gaze_col)
        res = evaluate(params, val_stems)
        if res.empty:
            continue
        recall = res["tp"].sum() / res["gt"].sum() if res["gt"].sum() else 0.0
        fa = res["fp"].sum() / res["hours"].sum() if res["hours"].sum() else float("nan")
        print(f"head {head_thr:>4} gaze {gaze_thr:.2f} dur {min_dur:.2f} gap {merge_gap:.2f} | "
              f"recall {recall:.2f} | FA/hr {fa:7.2f}")
        results.append((head_thr, gaze_thr, min_dur, merge_gap, recall, fa))

    print("\ncandidates (highest recall, then lowest FA/hr):")
    for head_thr, gaze_thr, min_dur, merge_gap, recall, fa in sorted(
            results, key=lambda r: (-r[4], r[5]))[:5]:
        print(f"  head {head_thr:>4} gaze {gaze_thr:.2f} dur {min_dur:.2f} gap {merge_gap:.2f} | "
              f"recall {recall:.2f} | FA/hr {fa:7.2f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sweep", action="store_true", help="grid-search thresholds on val people")
    ap.add_argument("--policy", action="store_true",
                    help="use policy.yaml thresholds (the tuned pose_v2 values)")
    ap.add_argument("--stems", nargs="*", help="restrict evaluation to these sessions")
    for name, val in DEFAULTS.items():
        if name == "gaze_col":
            ap.add_argument("--gaze_col", choices=["gaze_h", "gaze_iris"], default="gaze_h")
        else:
            ap.add_argument(f"--{name}", type=float, default=val)
    args = ap.parse_args()

    if args.sweep:
        sweep(args.gaze_col)
        return

    if args.policy:
        import yaml
        with open(ROOT.parent / "policy.yaml", encoding="utf-8") as f:
            policy = yaml.safe_load(f)
        p = policy["pose"]
        params = {"baseline_s": float(p["baseline_s"]), "head_thr": float(p["head_thr_deg"]),
                  "gaze_thr": float(p["gaze_thr"]), "min_dur": float(p["min_dur_s"]),
                  "merge_gap": float(p["merge_gap_s"]),
                  "gaze_col": p.get("gaze_col", "gaze_h"),
                  "smooth_s": float(p.get("smooth_s", 0.4))}
        print(f"policy {policy['policy_version']} | head {params['head_thr']} deg | "
              f"gaze {params['gaze_thr']} | min_dur {params['min_dur']} s")
    else:
        params = {k: getattr(args, k) for k in DEFAULTS}
    res = evaluate(params, stems=args.stems or None)
    if res.empty:
        sys.exit("\nno evaluable people — need features CSVs AND labels/<stem>_gt.csv files")
    print(res.to_string(index=False))
    if res["gt"].sum():
        print(f"\noverall: recall {res['tp'].sum() / res['gt'].sum():.2f} | "
              f"FA/hr {res['fp'].sum() / res['hours'].sum():.2f}")
    print("\nbreakdown:")
    print(res.groupby(["lighting", "glasses"]).agg(
        gt=("gt", "sum"), tp=("tp", "sum"), fp=("fp", "sum"),
        recall=("recall", "mean"), fa_per_hour=("fa_per_hour", "mean")).to_string())


if __name__ == "__main__":
    main()
