// Central configuration — all environment access lives here.

export const config = {
  /** ML inference demo server (machine learning/webcam_demo.py). */
  mlWsUrl: process.env.NEXT_PUBLIC_ML_WS_URL ?? "ws://127.0.0.1:8000/ws",
  /** AIsmering backend API base (backend/app). */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010/api/v1",
  /** Use the real backend instead of fixtures (backend must be running). */
  apiEnabled: (process.env.NEXT_PUBLIC_API_ENABLED ?? "false") === "true",
  /** Development demo mode: labeled fixtures + demo auth. */
  demoMode: (process.env.NEXT_PUBLIC_DEMO_MODE ?? "true") === "true",
};
