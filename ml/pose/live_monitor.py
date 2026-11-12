"""Incremental pose deviation monitor for live sessions.

Mirrors detect.py semantics on a stream: face frames during the calibration
window (baseline_s) set the per-session baseline (median yaw/gaze); after
calibration, the head and gaze channels are monitored INDEPENDENTLY (the
plan's event catalog treats them as separate event types), each with its own
threshold and the shared min_dur/merge_gap rules. The calibration window
never emits events.

Self-contained (numpy + yaml only) so it is unit-testable without a camera.
"""
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parent
POLICY_PATH = ROOT.parent / "policy.yaml"

EVENT_TYPE_MAP = {"head_pose": "head_pose_deviation", "gaze": "gaze_deviation"}


def wrap180(d: float) -> float:
    return (d + 180.0) % 360.0 - 180.0


def load_policy() -> dict:
    with open(POLICY_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


class _ChannelTracker:
    """Opens/closes an event for one channel's deviation signal."""

    def __init__(self, thr: float, min_dur: float, merge_gap: float):
        self.thr = thr
        self.min_dur = min_dur
        self.merge_gap = merge_gap
        self._start = None
        self._last = None
        self._peak_yaw = 0.0
        self._peak_gaze = 0.0

    def update(self, dev: float, abs_dyaw: float, abs_dgaze: float, t_s: float) -> dict | None:
        """Feed one frame; returns a closed event dict or None."""
        if dev >= self.thr:
            if self._start is None:
                self._start = t_s
            self._last = t_s
            self._peak_yaw = max(self._peak_yaw, abs_dyaw)
            self._peak_gaze = max(self._peak_gaze, abs_dgaze)
            return None
        if self._start is not None and t_s - self._last > self.merge_gap:
            return self._close()
        return None

    def _close(self) -> dict | None:
        start, end = self._start, self._last
        peak_yaw, peak_gaze = self._peak_yaw, self._peak_gaze
        self._start = None
        self._last = None
        self._peak_yaw = 0.0
        self._peak_gaze = 0.0
        if start is None or end - start < self.min_dur:
            return None
        return {
            "start_s": round(start, 3),
            "end_s": round(end, 3),
            "duration_s": round(end - start, 3),
            "peak_yaw_dev": round(peak_yaw, 2),
            "peak_gaze_dev": round(peak_gaze, 3),
        }


class LivePoseMonitor:
    """One instance per live session. Feed frames via update()."""

    def __init__(self, policy: dict | None = None):
        policy = policy or load_policy()
        p = policy["pose"]
        self.baseline_s = float(p["baseline_s"])
        self.head_thr = float(p["head_thr_deg"])
        self.gaze_thr = float(p["gaze_thr"])
        self.min_dur = float(p["min_dur_s"])
        self.merge_gap = float(p["merge_gap_s"])
        self.smooth_s = float(p.get("smooth_s", 0.4))
        self.catalog = policy["event_catalog"]
        self.policy_ref = policy["policy_version"]

        self._calib = []  # (yaw, gaze, pitch) collected during calibration
        self.base_yaw = None
        self.base_gaze = None
        self.base_pitch = None
        self._ema_yaw = 0.0
        self._ema_gaze = 0.0
        self._last_t = None
        self._head = _ChannelTracker(self.head_thr, self.min_dur, self.merge_gap)
        self._gaze = _ChannelTracker(self.gaze_thr, self.min_dur, self.merge_gap)

    @property
    def calibrated(self) -> bool:
        return self.base_yaw is not None

    def seconds_remaining(self, t_s: float) -> float:
        return max(0.0, self.baseline_s - t_s) if not self.calibrated else 0.0

    def _emit(self, event: dict, etype: str) -> dict:
        key = EVENT_TYPE_MAP[etype]
        event["event_type"] = key
        event["severity"] = self.catalog.get(key, "medium")
        return event

    def update(self, yaw, pitch, roll, gaze, face: int, t_s: float) -> list[dict]:
        """Feed one frame; returns newly finished events (may be empty)."""
        if face != 1:
            return []

        # calibration phase
        if not self.calibrated:
            if t_s < self.baseline_s:
                self._calib.append((yaw, gaze, pitch))
            if t_s >= self.baseline_s and self._calib:
                ys = [v[0] for v in self._calib]
                gs = [v[1] for v in self._calib]
                ps = [v[2] for v in self._calib]
                self.base_yaw = float(np.median(ys))
                self.base_gaze = float(np.median(gs))
                self.base_pitch = float(np.median(ps))
                self._ema_yaw = self.base_yaw
                self._ema_gaze = self.base_gaze
            return []  # calibration never emits events

        # causal EMA smoothing (same time constant as offline smooth_s)
        dt = t_s - self._last_t if self._last_t is not None else 1.0 / 30.0
        self._last_t = t_s
        alpha = min(1.0, dt / self.smooth_s) if self.smooth_s > 0 else 1.0
        self._ema_yaw += alpha * (yaw - self._ema_yaw)
        self._ema_gaze += alpha * (gaze - self._ema_gaze)

        dyaw = wrap180(self._ema_yaw - self.base_yaw)
        dgaze = self._ema_gaze - self.base_gaze
        head_dev = abs(dyaw)

        events = []
        event = self._head.update(head_dev, head_dev, abs(dgaze), t_s)
        if event:
            events.append(self._emit(event, "head_pose"))
        event = self._gaze.update(abs(dgaze), head_dev, abs(dgaze), t_s)
        if event:
            events.append(self._emit(event, "gaze"))
        return events

    def close_session(self) -> list[dict]:
        """Force-close any open events (server shutdown / disconnect)."""
        events = []
        for tracker, etype in ((self._head, "head_pose"), (self._gaze, "gaze")):
            event = tracker._close()
            if event:
                events.append(self._emit(event, etype))
        return events
