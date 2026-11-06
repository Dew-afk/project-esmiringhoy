// Central configuration — all environment access lives here.

export const config = {
  /** ML inference demo server (machine learning/webcam_demo.py). */
  mlWsUrl: process.env.NEXT_PUBLIC_ML_WS_URL ?? "ws://127.0.0.1:8000/ws",
  /** Future backend API base — nothing is implemented at this URL yet. */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api",
  /** Development demo mode: labeled fixtures + demo auth. */
  demoMode: (process.env.NEXT_PUBLIC_DEMO_MODE ?? "true") === "true",
};
