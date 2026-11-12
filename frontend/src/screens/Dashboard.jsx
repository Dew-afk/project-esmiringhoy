import { useCallback, useEffect, useState } from 'react'
import { Panel, Banner, Empty, Field } from '../ui.jsx'
import { proctorApi } from '../api.js'

const SEVERITIES = ['low', 'medium', 'high', 'critical']

const fmtAt = (s) => {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function Dashboard() {
  const [sessions, setSessions] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [session, setSession] = useState(null) // {meta, flags, risk}
  const [flags, setFlags] = useState([])
  const [selected, setSelected] = useState([])
  const [escalateFor, setEscalateFor] = useState(null)
  const [escRef, setEscRef] = useState('')
  const [escNote, setEscNote] = useState('')
  const [notes, setNotes] = useState({}) // event_id -> reviewer note
  const [busy, setBusy] = useState(false)

  const loadSessions = useCallback(() => {
    proctorApi.sessions()
      .then((d) => { setSessions(d.sessions); setError(null) })
      .catch((e) => setError(e.detail || 'could not load sessions'))
  }, [])

  useEffect(loadSessions, [loadSessions])

  const openSession = async (s) => {
    setBusy(true)
    try {
      const d = await proctorApi.flags(s.id)
      setSession({ meta: d.session, risk: d.risk })
      setFlags(d.flags)
      setSelected([])
      setEscalateFor(null)
      setNotes({})
    } catch (e) {
      setError(e.detail || 'could not load flags')
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn) => {
    setBusy(true)
    try {
      await fn()
      await openSession({ id: session.meta.id })
      loadSessions()
    } catch (e) {
      setError(e.detail || 'action failed')
    } finally {
      setBusy(false)
    }
  }

  const bulkable = flags.filter((f) => selected.includes(f.event_id)
    && (f.severity_override || f.severity) === 'low' && !f.review_action)
  const bulkTypes = [...new Set(bulkable.map((f) => f.event_type))]

  const bulkDismiss = () => {
    if (bulkTypes.length !== 1) {
      setError('bulk-dismiss needs one event type selected')
      return
    }
    act(() => proctorApi.bulkDismiss(session.meta.id, bulkTypes[0]))
  }

  const riskScore = session?.risk?.score

  return (
    <>
      {error && <Banner><b>error:</b> {error}</Banner>}
      <Banner>
        <b>proctor console:</b> sessions, flags and review actions are live from the
        backend; every action is audit-logged. flags and scores are advisory —
        no code path sets a cheating outcome
      </Banner>

      <Panel title="sessions">
        {sessions === null ? (
          <Empty>loading sessions…</Empty>
        ) : sessions.length === 0 ? (
          <Empty>no exam sessions yet: rows appear when students start exams</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>exam</th><th>student</th>
                  <th>risk score (advisory)</th><th>flags</th><th>unreviewed</th><th>state</th><th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.exam}</td><td>{s.student}</td>
                    <td className="num">{s.risk_score != null ? Number(s.risk_score).toFixed(2) : '—'}</td>
                    <td className="num">{s.flag_count}</td>
                    <td className="num">{s.unreviewed_count}</td>
                    <td><span className={`chip chip-${s.status === 'in_progress' ? 'in-progress' : 'completed'}`}>{s.status.replace('_', ' ')}</span></td>
                    <td><button className="btn small ghost" disabled={busy} onClick={() => openSession(s)}>open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {session && (
        <Panel title={`review: ${session.meta.exam} — ${session.meta.id.slice(0, 8)}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 'var(--text-title)', fontVariantNumeric: 'tabular-nums' }}>
              risk {riskScore != null ? Number(riskScore).toFixed(2) : '—'}
            </span>
            <span className="chip chip-in-progress">advisory, not a finding</span>
            {session.risk?.version && (
              <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>model {session.risk.version}</span>
            )}
          </div>
          {flags.length === 0 ? (
            <Empty>no flags recorded for this session</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>select</th><th>at</th><th>event</th><th>severity</th>
                    <th>override (original kept)</th><th>note</th><th>review</th><th>actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => {
                    const effSev = f.severity_override || f.severity
                    const reviewed = f.review_action
                    return (
                      <tr key={f.event_id}>
                        <td><input type="checkbox" aria-label={`select ${f.event_type}`}
                              checked={selected.includes(f.event_id)} disabled={!!reviewed}
                              onChange={(e) => setSelected((sel) => e.target.checked ? [...sel, f.event_id] : sel.filter((x) => x !== f.event_id))} /></td>
                        <td className="num">{fmtAt(f.start_s)}</td>
                        <td>{f.event_type}{f.conf != null ? ` (${Math.round(f.conf * 100)}%)` : ''}</td>
                        <td>
                          <span className={`leg sev-${effSev}`}>
                            {effSev === 'critical' && <span className="sev-mark" aria-hidden="true">!</span>}
                            {effSev}
                          </span>
                          {f.severity_override && (
                            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-label)' }}>
                              {' '}was {f.severity}
                            </span>
                          )}
                        </td>
                        <td>
                          <select className="select" style={{ height: 28, fontSize: 'var(--text-label)' }}
                            value={f.severity_override || ''} disabled={busy}
                            onChange={(e) => act(() => proctorApi.severity(f.event_id, e.target.value || f.severity))}
                            aria-label={`override severity for ${f.event_type}`}>
                            <option value="">keep {f.severity}</option>
                            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="input" style={{ height: 28, fontSize: 'var(--text-label)' }}
                            placeholder={f.review_note || 'reviewer note'}
                            value={notes[f.event_id] ?? f.review_note ?? ''}
                            onChange={(e) => setNotes((n) => ({ ...n, [f.event_id]: e.target.value }))}
                            aria-label={`note for ${f.event_type}`} />
                        </td>
                        <td>
                          {reviewed ? (
                            <span className="chip chip-completed">{reviewed}</span>
                          ) : (
                            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-label)' }}>new</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {!reviewed && (
                              <>
                                <button className="btn small ghost" disabled={busy}
                                  onClick={() => act(() => proctorApi.review(f.event_id, 'acknowledged', notes[f.event_id]))}>acknowledge</button>
                                <button className="btn small ghost" disabled={busy}
                                  onClick={() => act(() => proctorApi.review(f.event_id, 'dismissed', notes[f.event_id]))}>dismiss</button>
                                <button className="btn small ghost" disabled={busy}
                                  onClick={() => { setEscalateFor(f.event_id); setEscRef(''); setEscNote('') }}>escalate</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {escalateFor && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Banner>escalating {flags.find((f) => f.event_id === escalateFor)?.event_type}: marks the flag escalated and keeps the recording reference. no case is created — that needs a change request</Banner>
              <div className="formrow">
                <Field id="esc-ref" label="recording reference">
                  <input className="input" id="esc-ref" placeholder="rec_… (optional)" value={escRef}
                    onChange={(e) => setEscRef(e.target.value)} />
                </Field>
                <Field id="esc-note" label="context note">
                  <input className="input" id="esc-note" placeholder="what you saw" value={escNote}
                    onChange={(e) => setEscNote(e.target.value)} />
                </Field>
                <button className="btn" disabled={busy}
                  onClick={() => act(() => proctorApi.escalate(escalateFor, escRef, escNote)).then(() => setEscalateFor(null))}>
                  escalate
                </button>
                <button className="btn ghost" onClick={() => setEscalateFor(null)}>cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button className="btn small danger" disabled={busy || !bulkable.length || bulkTypes.length !== 1}
              onClick={bulkDismiss}>
              bulk-dismiss {bulkable.length} low{bulkTypes.length === 1 ? ` (${bulkTypes[0]})` : ''}
            </button>
            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
              unreviewed low-severity flags of one type in this session only; every row is audit-logged
            </span>
          </div>
        </Panel>
      )}

      <div className="grid" style={{ marginTop: 16 }}>
        <Panel title="ai summary (advisory)">
          <span className="chip chip-in-progress">advisory, separate from raw flags</span>
          <Empty>summaries arrive from the llm service with model version and timestamps: not built yet, nothing is invented here</Empty>
        </Panel>
        <Panel title="playback and export">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn ghost" disabled>export recording</button>
            <span style={{ color: 'var(--t-detail-80)', fontSize: 'var(--text-data)' }}>
              completed sessions only, via a short-lived presigned url; role and institution
              checked, audit logged; unavailable when never captured, purged or corrupt. not built yet (Phase 3)
            </span>
          </div>
        </Panel>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <Panel title="exam creation">
          <button className="btn ghost" disabled>create or configure exam (not connected)</button>
          <Empty>exams and rosters are managed in the admin console's exams tab once the exam service exists</Empty>
        </Panel>
        <Panel title="cohort analytics">
          <a className="link" href="#/reports" style={{ minHeight: 'auto', display: 'inline-block' }}>
            open cohort analytics
          </a>
          <Empty>aggregates come from the reporting service (SRS 3.1.10), never invented</Empty>
        </Panel>
      </div>
    </>
  )
}
