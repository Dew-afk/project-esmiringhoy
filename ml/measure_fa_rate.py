"""Debounced false-alarm rate on the P02 test videos.

Replays the raw test videos through train-4 at the live cadence (~15 fps)
with the same BooleanEventMonitor semantics as webcam_demo.py (open/close,
merge_gap, min_dur from policy.yaml) and counts phone and second-person
events per hour of video. P02 contains one subject and no phone, so every
emitted event is a false alarm. Events open at end-of-video are flushed
(counted), so this errs toward the worst case.

Run from ml/.
"""
from pathlib import Path

import cv2
import yaml
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "dataset" / "video dataset" / "raw"

policy = yaml.safe_load((ROOT / "policy.yaml").read_text(encoding="utf-8"))
MIN_DUR = float(policy["pose"]["min_dur_s"])
MERGE_GAP = float(policy["pose"]["merge_gap_s"])
CONF_PHONE = float(policy["yolo"]["conf_phone"])
CONF_PERSON = float(policy["yolo"]["conf_person"])


class BooleanEventMonitor:
    """Same semantics as webcam_demo.py: report on completion, after debounce."""

    def __init__(self):
        self.start = None
        self.last = None

    def update(self, active: bool, t: float) -> list[tuple[float, float]]:
        if active:
            if self.start is None:
                self.start = t
            self.last = t
            return []
        if self.start is not None and t - self.last > MERGE_GAP:
            start, end = self.start, self.last
            self.start = self.last = None
            if end - start >= MIN_DUR:
                return [(start, end)]
        return []


def main() -> None:
    model = YOLO(str(ROOT / "runs" / "detect" / "train-4" / "weights" / "best.pt"))
    phone_mon = BooleanEventMonitor()
    person_mon = BooleanEventMonitor()
    phone_events, person_events = [], []
    total_s = 0.0

    for video in sorted(RAW.glob("P02_*.mp4")):
        cap = cv2.VideoCapture(str(video))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        idx, sampled = 0, 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % 2 == 0:  # ~15 fps, the live cadence
                t = idx / fps
                r = model.predict(frame, imgsz=960, conf=min(CONF_PHONE, CONF_PERSON),
                                  verbose=False)[0]
                n_phone = sum(1 for b in r.boxes if int(b.cls[0]) == 0)
                n_person = sum(1 for b in r.boxes if int(b.cls[0]) == 1)
                phone_events += phone_mon.update(n_phone >= 1, t)
                person_events += person_mon.update(n_person >= 2, t)
                sampled += 1
            idx += 1
        # flush anything still open at end-of-video (worst-case counting)
        flush_t = idx / fps + MERGE_GAP + 0.1
        phone_events += phone_mon.update(False, flush_t)
        person_events += person_mon.update(False, flush_t)
        cap.release()
        total_s += idx / fps
        print(f"{video.name}: {idx / fps / 60:.1f} min, {sampled} frames sampled")

    hours = total_s / 3600
    print(f"\ntotal {total_s / 60:.1f} min video")
    for label, events in (("second_person (2+ boxes)", person_events),
                          ("unauthorized_object (phone)", phone_events)):
        rate = len(events) / hours
        print(f"  {label}: {len(events)} debounced events -> {rate:.2f}/hr")
        for s, e in events:
            print(f"    {s:.1f}s - {e:.1f}s ({(e - s):.1f}s)")
    target = 1.0
    print(f"\nsecond-person target: <= {target}/hr -> "
          f"{'PASS' if len(person_events) / hours <= target else 'FAIL'}")


if __name__ == "__main__":
    # Guard required on Windows: dataloader workers re-import this module.
    main()
