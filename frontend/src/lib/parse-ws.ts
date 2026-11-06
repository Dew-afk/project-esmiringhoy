import type {
  DetectionBox,
  EventFlag,
  EventType,
  GazeVector,
  MonitorPhase,
  Severity,
  WsReply,
} from "./types";

// Runtime validation for messages from machine learning/webcam_demo.py `/ws`.
// The server is the contract; never trust a payload at runtime.

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const EVENT_TYPES: EventType[] = [
  "gaze_deviation",
  "head_pose_deviation",
  "second_voice",
  "unauthorized_object",
  "second_person",
  "focus_loss",
  "copy_paste",
  "connectivity_interruption",
];

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isDetectionBox(v: unknown): v is DetectionBox {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isNum(o.x1) && isNum(o.y1) && isNum(o.x2) && isNum(o.y2) &&
    isNum(o.conf) && typeof o.label === "string"
  );
}

export function isGazeVector(v: unknown): v is GazeVector {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isNum(o.x) && isNum(o.y) && isNum(o.dx) && isNum(o.dy);
}

export function isEventFlag(v: unknown): v is EventFlag {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.event_id === "string" &&
    typeof o.session_id === "string" &&
    typeof o.event_type === "string" &&
    EVENT_TYPES.includes(o.event_type as EventType) &&
    typeof o.severity === "string" &&
    SEVERITIES.includes(o.severity as Severity) &&
    isNum(o.start_s) &&
    isNum(o.end_s) &&
    isNum(o.duration_s)
  );
}

/** Parse a WS message safely; returns null for anything malformed.
 *  `gaze` is optional — the server omits it entirely on a bad frame. */
export function parseWsReply(raw: unknown): WsReply | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.boxes)) return null;
  const state: MonitorPhase =
    o.state === "live" ? "live" : o.state === "calibrating" ? "calibrating" : "calibrating";
  return {
    boxes: o.boxes.filter(isDetectionBox),
    gaze: isGazeVector(o.gaze) ? o.gaze : null,
    ms: isNum(o.ms) ? o.ms : 0,
    state,
    seconds_remaining: isNum(o.seconds_remaining) ? o.seconds_remaining : 0,
    events: Array.isArray(o.events) ? o.events.filter(isEventFlag) : [],
  };
}

/** Mirror a box horizontally for the selfie-mirrored preview:
 *  x' = W - x (the original demo draws boxes unmirrored, which offsets
 *  them from the flipped video — this implementation fixes that). */
export function mirrorBox(box: DetectionBox, width: number): DetectionBox {
  return {
    ...box,
    x1: width - box.x2,
    x2: width - box.x1,
  };
}

/** Gaze geometry on the mirrored preview — same transform as webcam.html:
 *  base point and horizontal direction flipped, vertical unchanged. */
export function mirrorGaze(
  g: GazeVector,
  width: number,
  height: number
): { bx: number; by: number; ex: number; ey: number } {
  const bx = width - g.x * width;
  const by = g.y * height;
  return {
    bx,
    by,
    ex: bx - g.dx * width * 0.25,
    ey: by + g.dy * height * 0.32,
  };
}

export function gazeDirectionLabel(dx: number, dy: number): string {
  const h = dx > 0.15 ? "left" : dx < -0.15 ? "right" : "";
  const v = dy > 0.15 ? "down" : dy < -0.15 ? "up" : "";
  return [h, v].filter(Boolean).join("-") || "center";
}
