// Live backend operations — the same workflow the integration test verifies.
// Used by pages when config.apiEnabled is true.

import { api, setApiToken, getApiToken, type ApiEvent, type ApiExam, type ApiSession, type ApiUser } from "./api";
import { config } from "./config";

export const LiveApi = {
  async login(email: string, password: string): Promise<ApiUser> {
    const res = await api.post<{ access_token: string; user: ApiUser }>("/auth/login", { email, password });
    setApiToken(res.access_token);
    return res.user;
  },
  logout(): void {
    setApiToken(null);
  },
  /** Re-hydrate a stored session after reload. */
  async me(): Promise<ApiUser | null> {
    if (!getApiToken()) return null;
    try {
      return await api.get<ApiUser>("/auth/me");
    } catch {
      setApiToken(null);
      return null;
    }
  },
  myExams: () => api.get<ApiExam[]>("/exams/mine"),
  proctorSessions: () => api.get<ApiSession[]>("/sessions"),
  session: (id: string) => api.get<ApiSession>(`/sessions/${id}`),
  sessionEvents: (id: string) => api.get<ApiEvent[]>(`/sessions/${id}/events`),
  createSession: (examId: string) => api.post<ApiSession>("/sessions", { exam_id: examId }),
  endSession: (id: string) => api.post<ApiSession>(`/sessions/${id}/end`),
  registerMlSession: (sessionId: string, mlSessionId: string) =>
    api.post(`/sessions/${sessionId}/ml-register`, { ml_session_id: mlSessionId }),
  reviewEvent: (eventId: string, action: string, note?: string, severity?: string) =>
    api.post(`/events/${eventId}/review`, { action, note, severity }),
  bulkReview: (sessionId: string, eventIds: string[]) =>
    api.post(`/sessions/${sessionId}/bulk-review`, { event_ids: eventIds, action: "dismiss" }),
  auditReport: () => api.get<{ actor: string; action: string; target: string; at: string }[]>("/reports/audit"),

  /* ---------- admin ---------- */
  listExams: () => api.get<ApiExam[]>("/exams"),
  policies: () =>
    api.get<{ policy_template_id: string; name: string; description: string; severity_map: Record<string, string> }[]>("/exams/policies/list"),
  listUsers: () => api.get<ApiUser[]>("/admin/users"),
  listInstitutions: () =>
    api.get<{ institution_id: string; name: string; code: string; is_test: boolean }[]>("/admin/institutions"),
  approveUser: (userId: string) => api.post(`/admin/users/${userId}/approve`),
  importRoster: (form: FormData) => api.upload<{ created: string[]; skipped: number }>("/admin/rosters/import", form),
  createExam: (body: Record<string, unknown>) => api.post<ApiExam>("/exams", body),
  transitionExam: (examId: string, to: string) => api.post<ApiExam>(`/exams/${examId}/transition`, { to }),

  /* ---------- reports ---------- */
  cohort: (examId: string) =>
    api.get<{
      session_count: number;
      flag_distribution: Record<string, number>;
      event_type_breakdown: Record<string, number>;
      risk_score_distribution: { min: number | null; max: number | null; count: number; values: number[] };
    }>(`/reports/cohort/${examId}`),
  integrity: (sessionId: string) =>
    api.get<{
      status: string;
      advisory_risk_score: number | null;
      events: { event_id: string; event_type: string; severity: string; start_s: number; end_s: number; review_status: string }[];
      summary_available: boolean;
    }>(`/reports/integrity/${sessionId}`),
  appealsCases: () =>
    api.get<{ case_id: string; session_id: string; student_name: string; exam_title: string; opened_at: string; status: string; notes: string[]; event_ids: string[] }[]>("/reports/appeals"),

  /* ---------- database viewer ---------- */
  dbTables: () => api.get<{ tables: string[]; protected: string[]; view_only: string[]; deletable: string[] }>("/admin/db/tables"),
  dbRows: (table: string, limit = 50, offset = 0) =>
    api.get<{ columns: string[]; rows: Record<string, unknown>[]; total: number }>(`/admin/db/${table}?limit=${limit}&offset=${offset}`),
  dbDelete: (table: string, recordId: string) => api.delete<{ deleted: string }>(`/admin/db/${table}/${recordId}`),

  /* ---------- recordings ---------- */
  recordings: (sessionId: string) =>
    api.get<{ recording_id: string; session_id: string; format: string; size_bytes: number; available: boolean; created_at: string; dev_local: boolean }[]>(`/sessions/${sessionId}/recordings`),
  exportRecording: (recordingId: string) =>
    api.post<{ url: string; expires_s: number }>(`/sessions/recordings/${recordingId}/export`),
};

export const apiConnected = (): boolean => config.apiEnabled;

/* ---------- tiny data hook for live pages ---------- */

import { useEffect, useRef, useState } from "react";

export function useLiveData<T>(loader: () => Promise<T>, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = () => {
    setLoading(true);
    loaderRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Backend error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (enabled) reload();
  }, [enabled]); // loader identity changes are intentional (fresh fetch per id)

  return { data, error, loading, reload };
}
