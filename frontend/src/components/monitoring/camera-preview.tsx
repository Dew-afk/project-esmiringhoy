"use client";

// Live camera stage: mirrored video + detection boxes + gaze ray overlay.
// Boxes are drawn MIRRORED (unlike the reference webcam.html, whose boxes
// float offset from the flipped video — a documented quirk of that demo).
// The gaze ray is a relative direction, never screen-accurate eye tracking.

import { useCallback, useEffect, useRef } from "react";
import { CameraOff, Loader2, RefreshCw } from "lucide-react";
import type { DetectionBox, GazeVector, WsReply } from "@/lib/types";
import { gazeDirectionLabel, mirrorBox, mirrorGaze } from "@/lib/parse-ws";
import type { useMonitoring } from "./use-monitoring";
import { Banner, Button, cn } from "@/components/ui";

type Monitor = ReturnType<typeof useMonitoring>;

export function CameraPreview({
  monitor,
  className,
  showStatusLine = true,
  onCalibrationComplete,
  stream,
}: {
  monitor: Monitor;
  className?: string;
  showStatusLine?: boolean;
  /** Called once when the server reports state === "live". */
  onCalibrationComplete?: () => void;
  /** An already-permissioned stream (check-in flow gates camera behind consent). */
  stream?: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const liveNotified = useRef(false);

  // Draw boxes + gaze imperatively on every server message (15 fps).
  monitor.onFrame(
    useCallback(
      (msg: WsReply) => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const octx = overlay.getContext("2d");
        if (!octx) return;
        octx.clearRect(0, 0, overlay.width, overlay.height);
        drawOverlay(octx, msg.boxes, msg.gaze, overlay.width, overlay.height);
      },
      []
    )
  );

  // Notify once when calibration finishes.
  useEffect(() => {
    if (monitor.phase === "live" && !liveNotified.current) {
      liveNotified.current = true;
      onCalibrationComplete?.();
    }
  }, [monitor.phase, onCalibrationComplete]);

  const { start, stop } = monitor;
  const streamRef = useRef(stream);
  streamRef.current = stream;

  useEffect(() => {
    if (monitor.status === "idle" && videoRef.current && canvasRef.current) {
      void start(videoRef.current, canvasRef.current, streamRef.current);
    }
    return () => stop();
  }, [monitor.status, start, stop]);

  const { status, error, fps, ms, boxes, phase } = monitor;

  if (status === "error") {
    return (
      <div className={cn("flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4", className)}>
        <CameraOff className="h-8 w-8 text-red-400" />
        <p className="text-center text-xs font-medium text-red-800">
          Camera or monitoring service unavailable
        </p>
        <p className="max-w-xs text-center text-xs text-red-700">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          <RefreshCw className="h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} playsInline muted className="hidden" />
        <canvas ref={canvasRef} className="block w-full" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {status !== "live" && status !== "calibrating" && (
          <div className="absolute inset-0 flex items-center justify-center bg-navy-950/70">
            <div className="flex items-center gap-2 text-xs font-medium text-white">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "starting" ? "Requesting camera…" : "Connecting to monitoring service…"}
            </div>
          </div>
        )}
        {status === "reconnecting" && (
          <Banner tone="warning" className="absolute inset-x-2 top-2">
            Connection interrupted — reconnecting automatically.
          </Banner>
        )}
      </div>
      {showStatusLine && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500">
          <span>
            {status === "live"
              ? `${fps} fps · ${ms.toFixed(0)} ms inference · ${boxes.length} detection${boxes.length === 1 ? "" : "s"}`
              : status === "calibrating"
                ? "Calibrating — sit still, face the camera"
                : status}
          </span>
          {phase === "live" && (
            <span className="text-slate-400">Gaze ray: relative direction, not screen-accurate</span>
          )}
        </div>
      )}
    </div>
  );
}

function drawOverlay(
  octx: CanvasRenderingContext2D,
  boxes: DetectionBox[],
  gaze: GazeVector | null,
  w: number,
  h: number
) {
  for (const b of boxes) {
    const m = mirrorBox(b, w);
    octx.lineWidth = 3;
    octx.strokeStyle = "#00e676";
    octx.strokeRect(m.x1, m.y1, m.x2 - m.x1, m.y2 - m.y1);
    const label = `${m.label} ${Math.round(m.conf * 100)}%`;
    octx.font = "16px system-ui, sans-serif";
    const tw = octx.measureText(label).width + 10;
    octx.fillStyle = "#00e676";
    octx.fillRect(m.x1, m.y1 - 24, tw, 24);
    octx.fillStyle = "#000";
    octx.fillText(label, m.x1 + 5, m.y1 - 7);
  }

  if (!gaze) return;
  const g = mirrorGaze(gaze, w, h);
  // Eye-base marker
  octx.beginPath();
  octx.arc(g.bx, g.by, 5, 0, Math.PI * 2);
  octx.fillStyle = "rgba(0,229,255,0.9)";
  octx.fill();
  // Gaze ray
  octx.beginPath();
  octx.moveTo(g.bx, g.by);
  octx.lineTo(g.ex, g.ey);
  octx.strokeStyle = "rgba(255,234,0,0.85)";
  octx.lineWidth = 2;
  octx.stroke();
  octx.beginPath();
  octx.arc(g.ex, g.ey, 6, 0, Math.PI * 2);
  octx.fillStyle = "#ffea00";
  octx.fill();
  // Direction label
  octx.font = "13px system-ui, sans-serif";
  octx.fillStyle = "#ffea00";
  octx.fillText(gazeDirectionLabel(gaze.dx, gaze.dy), g.ex + 10, g.ey - 10);
}
