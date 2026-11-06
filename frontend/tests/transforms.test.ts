import { describe, expect, it } from "vitest";
import {
  gazeDirectionLabel,
  mirrorBox,
  mirrorGaze,
} from "../src/lib/parse-ws";

describe("mirrored overlay geometry (selfie-mirrored preview)", () => {
  it("mirrors box coordinates horizontally: x' = W - x", () => {
    const m = mirrorBox({ x1: 100, y1: 50, x2: 200, y2: 150, conf: 0.9, label: "phone" }, 960);
    expect(m.x1).toBeCloseTo(960 - 200);
    expect(m.x2).toBeCloseTo(960 - 100);
    expect(m.y1).toBe(50);
    expect(m.y2).toBe(150);
    expect(m.label).toBe("phone");
  });

  it("mirrors the gaze ray exactly like webcam.html (base + dx flipped, dy kept)", () => {
    const g = { x: 0.455, y: 0.505, dx: 0.166, dy: 0.157 };
    const m = mirrorGaze(g, 960, 540);
    expect(m.bx).toBeCloseTo(960 - 0.455 * 960);
    expect(m.by).toBeCloseTo(0.505 * 540);
    expect(m.ex).toBeCloseTo(m.bx - 0.166 * 960 * 0.25);
    expect(m.ey).toBeCloseTo(m.by + 0.157 * 540 * 0.32);
  });

  it("labels gaze direction from the subject's own perspective", () => {
    expect(gazeDirectionLabel(0.3, 0.0)).toBe("left");
    expect(gazeDirectionLabel(-0.3, 0.0)).toBe("right");
    expect(gazeDirectionLabel(0.0, -0.3)).toBe("up");
    expect(gazeDirectionLabel(0.0, 0.3)).toBe("down");
    expect(gazeDirectionLabel(0.3, 0.3)).toBe("left-down");
    expect(gazeDirectionLabel(0.0, 0.0)).toBe("center");
  });
});

describe("formatting helpers", () => {
  it("formats clocks and durations", async () => {
    const { formatClock, formatDuration } = await import("../src/lib/format");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(412.4)).toBe("6:52");
    expect(formatDuration(2.045)).toBe("2.0 s");
    expect(formatDuration(95)).toBe("1 m 35 s");
  });
});

describe("severity metadata", () => {
  it("ranks severities low < medium < high < critical", async () => {
    const { SEVERITY_META } = await import("../src/components/severity");
    const ranks = ["low", "medium", "high", "critical"].map(
      (s) => SEVERITY_META[s as keyof typeof SEVERITY_META].rank
    );
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it("turns event types into display labels", async () => {
    const { eventTypeLabel } = await import("../src/components/severity");
    expect(eventTypeLabel("head_pose_deviation")).toBe("Head Pose Deviation");
    expect(eventTypeLabel("second_person")).toBe("Second Person");
  });
});
