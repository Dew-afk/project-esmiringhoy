import type { EventType, Severity } from "./types";

// Event catalog + severities — mirrors machine learning/policy.yaml
// (pose_v2), which is the source of truth. Capability status reflects the
// actual repository state, not the plan.
export const EVENT_CATALOG: Record<
  EventType,
  { severity: Severity; source: string; status: "live" | "not-started" }
> = {
  gaze_deviation: {
    severity: "medium",
    source: "MediaPipe iris gaze",
    status: "live",
  },
  head_pose_deviation: {
    severity: "medium",
    source: "MediaPipe head pose",
    status: "live",
  },
  second_voice: {
    severity: "high",
    source: "audio classification",
    status: "not-started",
  },
  unauthorized_object: {
    severity: "high",
    source: "YOLO (phone class)",
    status: "live",
  },
  second_person: {
    severity: "critical",
    source: "YOLO (2+ person boxes)",
    status: "live",
  },
  focus_loss: {
    severity: "medium",
    source: "browser behavior",
    status: "not-started",
  },
  copy_paste: {
    severity: "low",
    source: "browser behavior",
    status: "not-started",
  },
  connectivity_interruption: {
    severity: "low",
    source: "network monitoring",
    status: "not-started",
  },
};

/** Baseline duration used only to render calibration progress; the server
 *  sends `seconds_remaining`, which is the authoritative value. Must match
 *  policy.yaml pose.baseline_s (10.0). */
export const CALIBRATION_BASELINE_S = 10.0;
