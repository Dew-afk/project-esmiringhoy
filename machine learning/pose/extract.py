"""Phase D — extract per-frame head-pose and gaze features with MediaPipe.

For every video in <dataset>/raw, writes one CSV into <dataset>/features:
    frame_idx, t_s, face, yaw, pitch, roll, gaze_h
where face=1 if a face was detected that frame (features are NaN otherwise).

Sign conventions (verify visually on the first test run):
    yaw    + = head turned toward the subject's LEFT
    pitch  + = head tilted UP
    roll   + = head rolled toward the subject's LEFT shoulder
    gaze_h + = eyes looking toward the subject's RIGHT

Usage (from the pose/ folder, venv activated):
    python extract.py                     # all videos in raw/
    python extract.py --video "P01_s1"    # one video, by stem
    python extract.py --video P01_s1 --plot   # also save a yaw/pitch/gaze_h plot
"""
import argparse
import math
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

try:
    from gaze_utils import iris_gaze_h          # run directly: python extract.py
except ImportError:
    from pose.gaze_utils import iris_gaze_h     # imported as a package (webcam_demo.py)

ROOT = Path(__file__).resolve().parent
DATASET = ROOT.parent / "dataset" / "video dataset"
RAW_DIR = DATASET / "raw"
FEAT_DIR = DATASET / "features"
# Local copy: MediaPipe's C++ layer cannot read paths containing spaces
# ("video dataset"), so the task file lives here instead.
TASK_PATH = ROOT / "face_landmarker.task"

BLENDSHAPE_KEYS = ("eyeLookOutLeft", "eyeLookInLeft", "eyeLookOutRight", "eyeLookInRight")


def matrix_to_euler_deg(m: np.ndarray) -> tuple[float, float, float]:
    """Pitch/yaw/roll (degrees) from MediaPipe's 4x4 facial transformation matrix."""
    r = np.asarray(m)[:3, :3]
    sy = math.sqrt(r[0, 0] ** 2 + r[1, 0] ** 2)
    if sy < 1e-6:  # gimbal lock fallback
        pitch = math.degrees(math.atan2(-r[1, 2], r[1, 1]))
        yaw = math.degrees(math.atan2(-r[2, 0], sy))
        roll = 0.0
    else:
        pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
        yaw = math.degrees(math.atan2(-r[2, 0], sy))
        roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return yaw, pitch, roll


def gaze_h_from_blendshapes(blendshapes) -> float:
    """Horizontal gaze: + looks right. Combines the four eye-look blendshapes."""
    bs = {c.category_name: c.score for c in blendshapes}
    if not all(k in bs for k in BLENDSHAPE_KEYS):
        return float("nan")
    look_right = bs["eyeLookInLeft"] + bs["eyeLookOutRight"]
    look_left = bs["eyeLookOutLeft"] + bs["eyeLookInRight"]
    return look_right - look_left


def process_video(video_path: Path, out_csv: Path, step: int, plot: bool) -> None:
    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(TASK_PATH)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    detector = vision.FaceLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    rows, frames_done, faces_found = [], 0, 0
    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        frame_idx = frames_done
        frames_done += 1
        if frames_done % 500 == 0:
            print(f"  {video_path.name}: {frames_done}/{total_frames} frames", flush=True)
        if frame_idx % step != 0:
            continue

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        result = detector.detect(mp_image)

        t_s = frame_idx / fps
        if result.face_landmarks:
            faces_found += 1
            yaw, pitch, roll = matrix_to_euler_deg(result.facial_transformation_matrixes[0])
            gaze_h = gaze_h_from_blendshapes(result.face_blendshapes[0])
            gaze_iris = iris_gaze_h(result.face_landmarks[0])
            rows.append((frame_idx, round(t_s, 3), 1, round(yaw, 3), round(pitch, 3),
                         round(roll, 3), round(gaze_h, 4), round(gaze_iris, 4)))
        else:
            rows.append((frame_idx, round(t_s, 3), 0, float("nan"), float("nan"),
                         float("nan"), float("nan"), float("nan")))

    cap.release()
    detector.close()

    df = pd.DataFrame(rows, columns=["frame_idx", "t_s", "face", "yaw", "pitch", "roll",
                                     "gaze_h", "gaze_iris"])
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_csv, index=False)
    face_ratio = faces_found / max(len(rows), 1)
    print(f"{video_path.name}: {len(rows)} frames kept, face detected in {face_ratio:.1%} "
          f"-> {out_csv.relative_to(DATASET)}")

    if plot:
        plot_features(df, out_csv.with_suffix(".png"))


def plot_features(df: pd.DataFrame, out_png: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(3, 1, figsize=(12, 8), sharex=True)
    for ax, col, name in ((axes[0], "yaw", "yaw (deg)"), (axes[1], "pitch", "pitch (deg)"),
                          (axes[2], "gaze_h", "gaze_h (blendshape)")):
        ax.plot(df["t_s"], df[col], lw=0.6)
        ax.set_ylabel(name)
        ax.grid(alpha=0.3)
    axes[-1].set_xlabel("time (s)")
    fig.savefig(out_png, dpi=110)
    plt.close(fig)
    print(f"plot -> {out_png.relative_to(DATASET)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", help="video stem to process (e.g. P01_s1); default: all in raw/")
    ap.add_argument("--step", type=int, default=1, help="process every Nth frame")
    ap.add_argument("--plot", action="store_true", help="save a yaw/pitch/gaze_h plot")
    args = ap.parse_args()

    if not TASK_PATH.exists():
        sys.exit(f"missing {TASK_PATH} — download face_landmarker.task first")

    videos = [RAW_DIR / f"{args.video}.mp4"] if args.video else sorted(RAW_DIR.glob("*.mp4"))
    for v in videos:
        if not v.exists():
            sys.exit(f"video not found: {v}")
        process_video(v, FEAT_DIR / f"{v.stem}_features.csv", args.step, args.plot)


if __name__ == "__main__":
    main()
