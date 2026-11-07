// Thin typed client for the AIsmering backend (backend/app). Used when
// config.apiEnabled is true; demo fixtures remain the fallback otherwise.

import { config } from "./config";

const TOKEN_KEY = "aism.api_token";

export function setApiToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable — token lives in memory only
  }
}

export function getApiToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${config.apiBaseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body — keep generic message
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** multipart upload (recordings) — no JSON content-type */
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", headers: {}, body: form }),
};

/* ---------- Response shapes (backend contract) ---------- */

export interface ApiUser {
  user_id: string;
  role: string;
  full_name: string;
  email: string;
  institution_id: string;
  roster_id: string | null;
  department: string | null;
  approval_status: string;
  consent_status: string;
}

export interface ApiExam {
  exam_id: string;
  title: string;
  course_code: string;
  institution_id: string;
  window_start: string;
  window_end: string;
  duration_min: number;
  allowed_materials: string[];
  policy_template_id: string;
  status: string;
}

export interface ApiSession {
  session_id: string;
  exam_id: string;
  student_id: string;
  student_name: string;
  exam_title: string;
  institution_id: string;
  status: "scheduled" | "active" | "completed";
  start_time: string | null;
  end_time: string | null;
  risk_score: number | null;
  last_event_at: string | null;
  flag_count: number;
  highest_severity: string | null;
}

export interface ApiEvent {
  event_id: string;
  session_id: string;
  event_type: string;
  severity: string;
  start_s: number;
  end_s: number;
  duration_s: number;
  peak_yaw_dev: number | null;
  peak_gaze_dev: number | null;
  confidence: number | null;
  detector: string;
  policy_ref: string;
  source: string;
  review_status: string;
  reviewer_note: string | null;
  severity_override: string | null;
}
