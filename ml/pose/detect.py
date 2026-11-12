"""Phase D — turn feature CSVs into deviation events.

Baseline = median of the first `baseline_s` seconds (face==1 frames only),
per video — each person's own neutral pose. A frame is deviating when
|yaw - baseline| >= head_thr or |gaze_h - baseline| >= gaze_thr. Consecutive
deviating frames (gaps <= merge_gap tolerated) form one event; events shorter
than min_dur are dropped. Each event is classified by its dominant channel
(head_pose vs gaze).

Writes <features>/<stem>_events.csv: event_type, start_s, end_s, duration_s,
peak_yaw_dev, peak_gaze_dev.

Usage:
    python detect.py                          # all feature CSVs
    python detect.py --head_thr 15 --gaze_thr 0.25 --min_dur 0.5
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATASET = ROOT.parent / "dataset" / "video dataset"
FEAT_DIR = DATASET / "features"

DEFAULTS = {"baseline_s": 10.0, "head_thr": 15.0, "gaze_thr": 0.25,
            "min_dur": 0.5, "merge_gap": 0.25, "gaze_col": "gaze_h",
            "smooth_s": 0.4}


def wrap180(d: np.ndarray) -> np.ndarray:
    return (d + 180.0) % 360.0 - 180.0


def _channel_events(t, deviating, etype, dyaw, dgaze, min_dur, merge_gap):
    """Run the deviation state machine on one channel's boolean signal."""
    events = []
    i, n = 0, len(t)
    while i < n:
        if not deviating[i]:
            i += 1
            continue
        start = t[i]
        j, last_on = i, i
        while j < n:
            if deviating[j]:
                last_on = j
                j += 1
            elif t[j] - t[last_on] <= merge_gap:
                j += 1  # tolerate a short gap
            else:
                break
        end = t[last_on]
        if end - start >= min_dur:
            seg = slice(i, last_on + 1)
            events.append((etype, round(start, 3), round(end, 3), round(end - start, 3),
                           round(float(np.max(np.abs(dyaw[seg]))), 2),
                           round(float(np.max(np.abs(dgaze[seg]))), 3)))
        i = j
    return events


def detect_events(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """df: features CSV as loaded by load_features(). Returns one row per event.

    Head and gaze channels are detected INDEPENDENTLY — the plan's event
    catalog treats Head-Pose Deviation and Gaze Deviation as separate event
    types, and overlapping events of different types are allowed.
    """
    face = df["face"].to_numpy()
    t = df["t_s"].to_numpy()

    base_mask = face == 1
    base_mask &= t <= params["baseline_s"]
    if not base_mask.any():
        print(f"  warning: no face frames in first {params['baseline_s']}s — baseline unreliable")
        base_mask = face == 1
    base_yaw = float(np.nanmedian(df.loc[base_mask, "yaw"]))
    base_gaze = float(np.nanmedian(df.loc[base_mask, params["gaze_col"]]))

    dyaw = wrap180(df["yaw"].to_numpy() - base_yaw)
    dgaze = df[params["gaze_col"]].to_numpy() - base_gaze

    # temporal smoothing: kills single-frame noise blips; real deviations last
    # seconds and sail through (centered rolling mean, NaN-safe)
    if params.get("smooth_s", 0.0) > 0 and len(t) > 1:
        dt_med = float(np.median(np.diff(t)))
        window = max(1, int(round(params["smooth_s"] / dt_med)))
        dyaw_s = pd.Series(dyaw).rolling(window, center=True, min_periods=1).mean().to_numpy()
        dgaze_s = pd.Series(dgaze).rolling(window, center=True, min_periods=1).mean().to_numpy()
    else:
        dyaw_s, dgaze_s = dyaw, dgaze

    post_calib = t > params["baseline_s"]  # the calibration window emits no events
    in_face = face == 1
    head_flag = in_face & post_calib & (np.abs(dyaw_s) >= params["head_thr"])
    gaze_flag = in_face & post_calib & (np.abs(dgaze_s) >= params["gaze_thr"])

    events = []
    events += _channel_events(t, head_flag, "head_pose", dyaw, dgaze,
                              params["min_dur"], params["merge_gap"])
    events += _channel_events(t, gaze_flag, "gaze", dyaw, dgaze,
                              params["min_dur"], params["merge_gap"])
    events.sort(key=lambda e: e[1])

    cols = ["event_type", "start_s", "end_s", "duration_s", "peak_yaw_dev", "peak_gaze_dev"]
    return pd.DataFrame(events, columns=cols)


def load_features(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    cols = [c for c in ["frame_idx", "t_s", "face", "yaw", "pitch", "roll",
                        "gaze_h", "gaze_iris"] if c in df.columns]
    return df[cols]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--files", nargs="*", help="feature CSV(s); default: all in features/")
    for name, val in DEFAULTS.items():
        if name == "gaze_col":
            ap.add_argument("--gaze_col", choices=["gaze_h", "gaze_iris"], default="gaze_h",
                            help="gaze channel: blendshapes (gaze_h) or iris landmarks (gaze_iris)")
        else:
            ap.add_argument(f"--{name}", type=float, default=val)
    args = ap.parse_args()
    params = {k: getattr(args, k) for k in DEFAULTS}
    print(f"thresholds: head {params['head_thr']} deg | gaze {params['gaze_thr']} | "
          f"min_dur {params['min_dur']} s | baseline {params['baseline_s']} s")

    files = [Path(f) for f in args.files] if args.files else sorted(FEAT_DIR.glob("*_features.csv"))
    for f in files:
        if not f.exists():
            sys.exit(f"features not found: {f} (run extract.py first)")
        df = load_features(f)
        events = detect_events(df, params)
        out = f.with_name(f.stem.replace("_features", "_events") + ".csv")
        events.to_csv(out, index=False)
        n_pose = (events["event_type"] == "head_pose").sum()
        n_gaze = (events["event_type"] == "gaze").sum()
        hours = df["t_s"].iloc[-1] / 3600
        print(f"{f.stem}: {len(events)} events ({n_pose} head_pose, {n_gaze} gaze) "
              f"over {hours:.2f} h -> {out.name}")


if __name__ == "__main__":
    main()
