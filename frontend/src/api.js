// One API client module. Base URL comes from the environment, never a
// hardcoded host; in dev the vite proxy forwards /api to localhost:8001.
const BASE = import.meta.env.VITE_API_URL || '/api'

async function api(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include', // the session cookie is httpOnly, SameSite=Lax
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    // network failure: callers may fall back to DEV seeding in dev builds
    throw new TypeError('network error')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw Object.assign(new Error(detailText(data.detail)), { status: res.status, detail: detailText(data.detail) })
  }
  return res.json()
}

// FastAPI errors: detail is a string for app errors, an array of
// {type, loc, msg, ...} objects for 422 validation failures.
function detailText(detail) {
  if (!detail) return 'request failed'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ')
  }
  return detail.msg || JSON.stringify(detail)
}

export const authApi = {
  register: (payload) => api('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => api('/auth/login', { method: 'POST', body: payload }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  me: () => api('/auth/me'),
}

export const consentApi = {
  status: () => api('/consent'),
  grant: () => api('/consent/grant', { method: 'POST' }),
  revoke: () => api('/consent/revoke', { method: 'POST' }),
}

export const sessionApi = {
  mine: () => api('/sessions/mine'),
  myExams: () => api('/exams/mine'),
  start: (exam_id) => api('/sessions/start', { method: 'POST', body: { exam_id } }),
}

export const proctorApi = {
  sessions: () => api('/proctor/sessions'),
  flags: (session_id) => api(`/proctor/sessions/${session_id}/flags`),
  review: (event_id, action, note) =>
    api(`/flags/${event_id}/review`, { method: 'POST', body: { action, note: note || null } }),
  severity: (event_id, severity) =>
    api(`/flags/${event_id}/severity`, { method: 'POST', body: { severity } }),
  bulkDismiss: (exam_session_id, event_type) =>
    api('/flags/bulk-dismiss', { method: 'POST', body: { exam_session_id, event_type } }),
  escalate: (event_id, recording_ref, note) =>
    api(`/flags/${event_id}/escalate`, { method: 'POST', body: { recording_ref: recording_ref || null, note: note || null } }),
}

export const adminApi = {
  accounts: (status = 'pending') => api(`/admin/accounts?status=${status}`),
  approve: (user_id) => api(`/admin/accounts/${user_id}/approve`, { method: 'POST' }),
  disable: (user_id) => api(`/admin/accounts/${user_id}/disable`, { method: 'POST' }),
  create: (payload) => api('/admin/accounts', { method: 'POST', body: payload }),
}

export const appealsApi = {
  escalated: () => api('/appeals/escalated'),
}
