"use client";

import { CheckCircle2 } from "lucide-react";
import { CALIBRATION_BASELINE_S } from "@/lib/events";
import { ProgressBar } from "@/components/ui";

// Progress is derived from the server's `seconds_remaining` (authoritative);
// CALIBRATION_BASELINE_S only scales the bar and must match policy.yaml
// pose.baseline_s (10.0).
export function CalibrationPanel({
  phase,
  secondsRemaining,
}: {
  phase: "calibrating" | "live" | null;
  secondsRemaining: number;
}) {
  if (phase === "live") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <div className="text-xs">
          <p className="font-semibold text-green-900">Calibration complete — monitoring live</p>
          <p className="text-green-700">
            Deviations from your baseline are now being monitored by the ML service.
          </p>
        </div>
      </div>
    );
  }
  const remaining = Math.max(0, secondsRemaining);
  const progress = ((CALIBRATION_BASELINE_S - remaining) / CALIBRATION_BASELINE_S) * 100;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold text-amber-900">
          Calibrating… {remaining.toFixed(1)}s remaining
        </p>
        <p className="text-[11px] text-amber-700">Sit still, face the camera</p>
      </div>
      <ProgressBar value={progress} tone="amber" className="mt-2" />
    </div>
  );
}
