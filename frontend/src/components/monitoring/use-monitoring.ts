"use client";

// Live monitoring — the real integration with machine learning/webcam_demo.py.
//
// Contract (verified from webcam_demo.py source, 2026-10-31):
//   client → server: binary JPEG frames, ~15 fps, one per message
//   server → client: { boxes, gaze, ms, state, seconds_remaining, events }
//   - `gaze` is omitted (not null!) on bad frames — parser defaults it to null
//   - `state`: "calibrating" for the first ~10 s (per policy.yaml), then "live"
//   - `events`: newly finished EventsFlags rows (already carry event_id,
//     session_id, detector, policy_ref)
//
// Backpressure is preserved: the next frame is sent only after the previous
// frame's results arrive (same strategy as the reference webcam.html).

import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectionBox, EventFlag, GazeVector, MonitorPhase } from "@/lib/types";
import { parseWsReply } from "@/lib/parse-ws";

const FPS_TARGET = 15;
const MAX_EVENTS = 200;
const STATE_SYNC_MS = 250; // React re-renders at 4 Hz; overlays draw per message

export type MonitorStatus =
  | "idle"
  | "starting"
  | "connecting"
  | "calibrating"
  | "live"
  | "reconnecting"
  | "error"
  | "stopped";

export interface MonitoringSnapshot {
  status: MonitorStatus;
  phase: MonitorPhase | null;
  secondsRemaining: number;
  boxes: DetectionBox[];
  gaze: GazeVector | null;
  ms: number;
  events: EventFlag[];
  fps: number;
  error: string | null;
}

const INITIAL: MonitoringSnapshot = {
  status: "idle",
  phase: null,
  secondsRemaining: 0,
  boxes: [],
  gaze: null,
  ms: 0,
  events: [],
  fps: 0,
  error: null,
};

interface Internals {
  stream: MediaStream | null;
  ownsStream: boolean;
  ws: WebSocket | null;
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  awaiting: boolean;
  lastSend: number;
  stopped: boolean;
  reconnectDelay: number;
  latest: MonitoringSnapshot;
  dirty: boolean;
  lastSync: number;
  frames: number;
  fpsT: number;
}

export function useMonitoring(wsUrl: string) {
  const [snap, setSnap] = useState<MonitoringSnapshot>(INITIAL);
  const ref = useRef<Internals>({
    stream: null,
    ownsStream: true,
    ws: null,
    video: null,
    canvas: null,
    awaiting: false,
    lastSend: 0,
    stopped: true,
    reconnectDelay: 1000,
    latest: INITIAL,
    dirty: false,
    lastSync: 0,
    frames: 0,
    fpsT: 0,
  });
  // Called per message (15 fps) for imperative overlay drawing, outside React.
  const onFrameRef = useRef<((msg: NonNullable<ReturnType<typeof parseWsReply>>) => void) | null>(null);

  const connect = useCallback(() => {
    const r = ref.current;
    if (r.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setSnap((s) => ({ ...s, status: "error", error: `Could not open WebSocket to ${wsUrl}` }));
      return;
    }
    ws.binaryType = "arraybuffer";
    r.ws = ws;
    setSnap((s) => ({ ...s, status: "connecting", error: null }));

    ws.onopen = () => {
      r.reconnectDelay = 1000;
    };
    ws.onmessage = (e) => {
      let parsed: ReturnType<typeof parseWsReply> = null;
      try {
        parsed =
          typeof e.data === "string" ? parseWsReply(JSON.parse(e.data)) : parseWsReply(e.data);
      } catch {
        parsed = null;
      }
      r.awaiting = false; // results for the shown frame are in — allow next send
      if (!parsed) return;
      r.latest = {
        ...r.latest,
        phase: parsed.state,
        secondsRemaining: parsed.seconds_remaining,
        boxes: parsed.boxes,
        gaze: parsed.gaze,
        ms: parsed.ms,
        events: [...r.latest.events, ...parsed.events].slice(-MAX_EVENTS),
        status: parsed.state === "live" ? "live" : "calibrating",
        error: null,
      };
      r.dirty = true;
      onFrameRef.current?.(parsed);
    };
    ws.onclose = () => {
      if (ref.current.stopped) return;
      setSnap((s) => ({ ...s, status: "reconnecting" }));
      const delay = ref.current.reconnectDelay;
      ref.current.reconnectDelay = Math.min(delay * 2, 8000);
      setTimeout(() => connect(), delay);
    };
    ws.onerror = () => {
      // onclose follows and drives the reconnect
    };
  }, [wsUrl]);

  const loop = useCallback((t: number) => {
    const r = ref.current;
    if (r.stopped) return;
    requestAnimationFrame(loop);

    // Throttled React sync (4 Hz) so the sidebar doesn't re-render at 15 fps.
    if (r.dirty && t - r.lastSync > STATE_SYNC_MS) {
      r.dirty = false;
      r.lastSync = t;
      setSnap({ ...r.latest });
    }

    const ctx = r.canvas?.getContext("2d");
    const v = r.video;
    if (r.awaiting || !r.ws || r.ws.readyState !== WebSocket.OPEN || !ctx || !v) return;
    if (!v.videoWidth) return;
    if (t - r.lastSend < 1000 / FPS_TARGET) return;
    r.lastSend = t;

    const c = r.canvas;
    if (!c) return;
    // Selfie mirror: draw flipped so left/right feels natural.
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, c.width, c.height);
    ctx.restore();

    r.awaiting = true;
    c.toBlob((blob) => {
      if (blob && r.ws?.readyState === WebSocket.OPEN) {
        void blob.arrayBuffer().then((buf) => r.ws?.send(buf));
      } else {
        r.awaiting = false;
      }
    }, "image/jpeg", 0.7);

    r.frames++;
    if (t - r.fpsT >= 1000) {
      r.latest.fps = r.frames;
      r.frames = 0;
      r.fpsT = t;
      r.dirty = true;
    }
  }, []);

  /** Starts capture + WebSocket. Pass the <video> and <canvas> elements
   *  rendered by the camera preview, and optionally an already-permissioned
   *  stream (the check-in flow gates camera access behind consent). */
  const start = useCallback(
    async (
      video: HTMLVideoElement,
      canvas: HTMLCanvasElement,
      existingStream?: MediaStream
    ) => {
      const r = ref.current;
      r.stopped = false;
      setSnap({ ...INITIAL, status: "starting" });
      try {
        const stream =
          existingStream ??
          (await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }));
        r.stream = stream;
        // A caller-provided stream (consent-gated check-in flow) is not ours
        // to release — the caller owns its lifecycle.
        r.ownsStream = !existingStream;
        video.srcObject = stream;
        await video.play();
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const scale = Math.min(1, 960 / vw);
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);
        r.video = video;
        r.canvas = canvas;
        r.latest = { ...INITIAL, status: "connecting" };
        r.awaiting = false;
        r.lastSend = 0;
        connect();
        requestAnimationFrame(loop);
      } catch (err) {
        r.stopped = true;
        const message = err instanceof Error ? err.message : "Camera access failed";
        setSnap((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [connect, loop]
  );

  const stop = useCallback(() => {
    const r = ref.current;
    r.stopped = true;
    r.awaiting = false;
    if (r.ownsStream) {
      r.stream?.getTracks().forEach((t) => t.stop());
    }
    r.stream = null;
    r.ownsStream = true;
    if (r.ws && r.ws.readyState <= WebSocket.OPEN) r.ws.close();
    r.ws = null;
    r.video = null;
    r.canvas = null;
    // Back to idle so a later remount (e.g. re-entering the calibration step)
    // starts a fresh capture automatically.
    setSnap({ ...INITIAL, status: "idle" });
  }, []);

  // Release camera + socket when the page unmounts.
  useEffect(() => () => stop(), [stop]);

  /** Subscribe for per-message drawing (overlay canvas). */
  const onFrame = useCallback(
    (cb: ((msg: NonNullable<ReturnType<typeof parseWsReply>>) => void) | null) => {
      onFrameRef.current = cb;
    },
    []
  );

  return { ...snap, start, stop, onFrame };
}
