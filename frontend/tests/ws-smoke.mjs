// End-to-end smoke test against machine learning/webcam_demo.py `/ws`.
// Sends one tiny JPEG frame and prints the reply shape. Requires the ML
// server to be running (python webcam_demo.py) and a small JPEG at tests/frame.jpg.
// Usage: node tests/ws-smoke.mjs ws://127.0.0.1:8000/ws
import { readFileSync } from "node:fs";

const url = process.argv[2] ?? "ws://127.0.0.1:8000/ws";
const frame = readFileSync(new URL("./frame.jpg", import.meta.url));

const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  console.error("SMOKE FAIL: no reply within 15 s");
  process.exit(1);
}, 15000);

ws.onopen = () => ws.send(frame);
ws.onmessage = (e) => {
  clearTimeout(timeout);
  const msg = JSON.parse(String(e.data));
  const ok =
    Array.isArray(msg.boxes) &&
    (msg.gaze === null || typeof msg.gaze === "object") &&
    typeof msg.ms === "number" &&
    (msg.state === "calibrating" || msg.state === "live") &&
    typeof msg.seconds_remaining === "number" &&
    Array.isArray(msg.events);
  console.log("SMOKE", ok ? "PASS" : "FAIL", JSON.stringify({
    state: msg.state,
    seconds_remaining: msg.seconds_remaining,
    boxes: msg.boxes.length,
    gaze: msg.gaze,
    ms: msg.ms,
    events: msg.events.length,
  }));
  ws.close();
  process.exit(ok ? 0 : 1);
};
ws.onerror = () => {
  clearTimeout(timeout);
  console.error(`SMOKE FAIL: cannot connect to ${url} — is webcam_demo.py running?`);
  process.exit(1);
};
