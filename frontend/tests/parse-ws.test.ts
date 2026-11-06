import { describe, expect, it } from "vitest";
import {
  isDetectionBox,
  isEventFlag,
  isGazeVector,
  parseWsReply,
} from "../src/lib/parse-ws";

describe("parseWsReply — webcam_demo.py /ws contract", () => {
  const validReply = {
    boxes: [{ x1: 103, y1: 75, x2: 128, y2: 87, conf: 0.85, label: "phone" }],
    gaze: { x: 0.455, y: 0.505, dx: 0.166, dy: 0.157 },
    ms: 42.1,
    state: "calibrating",
    seconds_remaining: 7.2,
    events: [],
  };

  it("parses a full valid reply", () => {
    const r = parseWsReply(validReply);
    expect(r).not.toBeNull();
    expect(r!.state).toBe("calibrating");
    expect(r!.boxes).toHaveLength(1);
    expect(r!.gaze).toEqual(validReply.gaze);
  });

  it("defaults a missing gaze to null (server omits it on cv2.error frames)", () => {
    const { gaze: _gaze, ...withoutGaze } = validReply;
    const r = parseWsReply(withoutGaze);
    expect(r!.gaze).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(parseWsReply(null)).toBeNull();
    expect(parseWsReply("hello")).toBeNull();
    expect(parseWsReply(42)).toBeNull();
  });

  it("returns null when boxes is not an array", () => {
    expect(parseWsReply({ ...validReply, boxes: "nope" })).toBeNull();
  });

  it("filters malformed boxes and events instead of trusting them", () => {
    const r = parseWsReply({
      ...validReply,
      boxes: [
        { x1: 1, y1: 2, x2: 3, y2: 4, conf: 0.9, label: "phone" },
        { x1: "bad" },
        { x1: 1, y1: 2, x2: 3, y2: 4, conf: NaN, label: "person" },
      ],
      events: [
        { event_id: "a", session_id: "s", event_type: "gaze_deviation", severity: "medium", start_s: 1, end_s: 2, duration_s: 1 },
        { event_id: "b", session_id: "s", event_type: "not_a_real_type", severity: "medium", start_s: 1, end_s: 2, duration_s: 1 },
        "garbage",
      ],
    });
    expect(r!.boxes).toHaveLength(1);
    expect(r!.events).toHaveLength(1);
  });

  it("preserves full EventsFlags fields sent by the server", () => {
    const ev = {
      event_id: "live_20261003_234112-0001",
      session_id: "live_20261003_234112",
      event_type: "gaze_deviation",
      severity: "medium",
      start_s: 16.537,
      end_s: 18.582,
      duration_s: 2.045,
      peak_yaw_dev: 1.19,
      peak_gaze_dev: 0.303,
      detector: "pose_mediapipe",
      policy_ref: "pose_v2",
    };
    expect(isEventFlag(ev)).toBe(true);
    const r = parseWsReply({ ...validReply, events: [ev] });
    expect(r!.events[0]).toEqual(ev);
  });

  it("validates box and gaze guards", () => {
    expect(isDetectionBox({ x1: 0, y1: 0, x2: 10, y2: 10, conf: 0.5, label: "phone" })).toBe(true);
    expect(isDetectionBox({ x1: 0, y1: 0, x2: 10, conf: 0.5, label: "phone" })).toBe(false);
    expect(isGazeVector({ x: 0.5, y: 0.5, dx: 0.1, dy: 0.2 })).toBe(true);
    expect(isGazeVector({ x: 0.5, y: 0.5 })).toBe(false);
  });
});
