"""Extract sampled frames from the raw pose videos for YOLO negative mining.

Samples dataset/video dataset/raw/<person>_<session>.mp4 at --interval seconds
(default 2) so consecutive near-duplicate frames are avoided, resizes so the
long side is at most --max-side pixels (never upscales), and writes:
    data/_video_frames/<person>/<session>/NNNNN.jpg
    data/_video_frames/manifest.csv       (path, person, session, t_s)
    data/_video_frames/_contact_sheets/   (with --contact-sheet)

Frames are unlabeled; prep_dataset.py only uses them as negatives after paths
are approved in data/negatives_approved.txt. Re-running clears the staging
folder, which invalidates any existing approvals.

Usage:
    python extract_frames.py [--interval 2] [--max-side 1280] [--contact-sheet]
"""
import argparse
import csv
import shutil
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "dataset" / "video dataset" / "raw"
STAGING = ROOT / "data" / "_video_frames"


def extract_one(video: Path, interval: float, max_side: int,
                out_dir: Path, manifest: csv.writer) -> int:
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(interval * fps)))
    n, idx = 0, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            h, w = frame.shape[:2]
            longest = max(h, w)
            if longest > max_side:
                scale = max_side / longest
                frame = cv2.resize(frame, (int(round(w * scale)), int(round(h * scale))),
                                   interpolation=cv2.INTER_AREA)
            out = out_dir / f"{idx:05d}.jpg"
            cv2.imwrite(str(out), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            manifest.writerow([str(out.relative_to(ROOT)), out_dir.parent.name,
                               out_dir.name, f"{idx / fps:.3f}"])
            n += 1
        idx += 1
    cap.release()
    return n


def contact_sheet(frames: list[Path], out: Path, cols: int = 5, thumb: int = 320) -> None:
    """One labeled grid JPEG per session for quick visual review."""
    rows = [frames[i:i + cols] for i in range(0, len(frames), cols)]
    grid = []
    for row in rows:
        cells = []
        for f in row:
            im = cv2.imread(str(f))
            scale = thumb / max(im.shape[:2])
            im = cv2.resize(im, (int(round(im.shape[1] * scale)), int(round(im.shape[0] * scale))))
            cv2.putText(im, f.stem, (4, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
            cells.append(im)
        while len(cells) < cols:
            cells.append(np.zeros_like(cells[0]))
        grid.append(np.hstack(cells))
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), np.vstack(grid))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--interval", type=float, default=2.0, help="seconds between sampled frames")
    ap.add_argument("--max-side", type=int, default=1280, help="long side cap in px, never upscales")
    ap.add_argument("--contact-sheet", action="store_true", help="write a review grid per session")
    args = ap.parse_args()
    if args.interval <= 0 or args.max_side <= 0:
        ap.error("--interval and --max-side must be positive")

    shutil.rmtree(STAGING, ignore_errors=True)
    STAGING.mkdir(parents=True)

    videos = sorted(RAW.glob("*.mp4"))
    if not videos:
        raise SystemExit(f"no videos in {RAW}")
    total = 0
    with open(STAGING / "manifest.csv", "w", newline="") as mf:
        manifest = csv.writer(mf)
        manifest.writerow(["path", "person", "session", "t_s"])
        for video in videos:
            person, session = video.stem.split("_", 1)
            out_dir = STAGING / person / session
            out_dir.mkdir(parents=True)
            n = extract_one(video, args.interval, args.max_side, out_dir, manifest)
            print(f"{video.name}: {n} frames")
            total += n
            if args.contact_sheet:
                contact_sheet(sorted(out_dir.glob("*.jpg")),
                              STAGING / "_contact_sheets" / f"{person}_{session}.jpg")
    print(f"total: {total} frames -> {STAGING}")


if __name__ == "__main__":
    main()
