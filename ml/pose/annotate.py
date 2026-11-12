"""Ground-truth annotation helper — watch a video and mark deviation events.

Keys:
  h        toggle a head_pose event (press to start, press again to end)
  g        toggle a gaze event
  u        undo the last closed event
  n / b    jump forward / back 5 s
  q        quit and save

Events are written to labels/<stem>_gt.csv as event_type,start_s,end_s.
One event must be closed before opening another. Rough timing is fine —
evaluate.py matches with 50% overlap.

Usage (venv activated, from pose/):
    python annotate.py P04_s1 [--fps_scale 0.75]   # slower playback = easier marking
"""
import argparse
import csv
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent
DS = ROOT.parent / "dataset" / "video dataset"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("stem", help="video stem, e.g. P04_s1")
    ap.add_argument("--fps_scale", type=float, default=1.0, help="playback speed (0.5 = half)")
    args = ap.parse_args()

    video = DS / "raw" / f"{args.stem}.mp4"
    out = DS / "labels" / f"{args.stem}_gt.csv"
    if not video.exists():
        sys.exit(f"missing {video}")
    out.parent.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    events = []          # (type, start_s, end_s)
    open_type, open_start = None, None

    print(f"annotating {args.stem}: {total / fps:.0f}s at x{args.fps_scale} speed")
    print("  h = head_pose toggle | g = gaze toggle | n/b = +/-5s | q = save & quit")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
        t = frame_idx / fps

        cv2.putText(frame, f"t = {t:.1f}s ({t / 60:.1f} min)", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        if open_type:
            cv2.putText(frame, f"OPEN {open_type} since {open_start:.1f}s", (20, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        cv2.putText(frame, f"marked: {len(events)}", (20, 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)

        cv2.imshow("annotate", cv2.resize(frame, (960, 540)))
        key = cv2.waitKey(int(1000 / fps / args.fps_scale)) & 0xFF

        if key == ord('q') or key == 27:
            break
        elif key in (ord('h'), ord('g')):
            etype = 'head_pose' if key == ord('h') else 'gaze'
            if open_type is None:
                open_type, open_start = etype, round(t, 2)
            elif open_type == etype:
                if t > open_start:
                    events.append((etype, open_start, round(t, 2)))
                open_type = open_start = None
            else:
                print(f"  close the open {open_type} first (press '{open_type[0]}')")
        elif key == ord('u'):
            if events:
                removed = events.pop()
                print(f"  removed: {removed[0]} {removed[1]}s-{removed[2]}s")
            else:
                print("  nothing to undo")
        elif key == ord('n'):
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(frame_idx + 5 * fps, total - 1))
        elif key == ord('b'):
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(frame_idx - 5 * fps, 0))

    if open_type is not None and t > open_start:
        events.append((open_type, open_start, round(t, 2)))

    cap.release()
    cv2.destroyAllWindows()

    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["event_type", "start_s", "end_s"])
        w.writerows(events)
    print(f"saved {len(events)} events -> {out.relative_to(DS)}")


if __name__ == "__main__":
    main()
