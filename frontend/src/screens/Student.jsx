import { useEffect, useState } from 'react'
import { Panel, Banner, Empty } from '../ui.jsx'
import LiveSession from '../LiveSession.jsx'
import { consentApi, sessionApi } from '../api.js'

export default function Student() {
  const [consent, setConsent] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [exams, setExams] = useState(null)
  const [session, setSession] = useState(null) // {session_id, session_token, exam}
  const [starting, setStarting] = useState(null)

  useEffect(() => {
    consentApi.status()
      .then((d) => setConsent(d.status === 'granted'))
      .catch((e) => setError(e.detail || 'could not load consent status'))
    sessionApi.myExams()
      .then((d) => setExams(d.exams || []))
      .catch(() => setExams([]))
  }, [])

  const act = async (fn, apply) => {
    setBusy(true)
    setError(null)
    try {
      const d = await fn()
      apply(d)
    } catch (e) {
      setError(e.detail || 'request failed')
    } finally {
      setBusy(false)
    }
  }

  const grant = () => act(consentApi.grant, () => setConsent(true))
  const revoke = () => act(consentApi.revoke, () => { setConsent(false); setSession(null) })

  const startExam = (exam) => {
    setStarting(exam.id)
    act(() => sessionApi.start(exam.id), (d) => setSession(d))
      .finally(() => setStarting(null))
  }

  return (
    <>
      <Banner>
        <b>student console:</b> consent and session start are enforced by the backend;
        the camera screen is the real live pipeline bound to your session
      </Banner>
      {error && <Banner><b>error:</b> {error}</Banner>}

      <Panel title="consent">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
            server status: {consent === null ? 'loading…' : consent ? 'granted' : 'not granted'}
          </span>
          <div className="formrow">
            <button className="btn" disabled={busy || consent !== false} onClick={grant}>
              grant consent
            </button>
            <button className="btn ghost" disabled={busy || consent !== true} onClick={revoke}>
              revoke consent
            </button>
          </div>
          <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
            revoking blocks session start: the backend re-checks consent on every start
          </span>
        </div>
      </Panel>

      <Panel title="exam session">
        {exams === null ? (
          <Empty>loading your exams…</Empty>
        ) : exams.length === 0 ? (
          <Empty>no exams on your roster yet</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {exams.map((e) => (
              <div key={e.id} className="formrow" style={{ alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{e.name}</span>
                <span className={`chip chip-${e.lifecycle === 'in_progress' ? 'in-progress' : 'draft'}`}>
                  {e.lifecycle.replace('_', ' ')}
                </span>
                <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
                  {e.duration_minutes} min
                </span>
                <button className="btn small" disabled={busy || e.lifecycle !== 'in_progress' || consent !== true || starting === e.id}
                  onClick={() => startExam(e)}>
                  {starting === e.id ? 'starting…' : 'start exam'}
                </button>
              </div>
            ))}
          </div>
        )}
        {session && (
          <p style={{ color: 'var(--dim)', fontSize: 'var(--text-data)', margin: '12px 0 0' }}>
            session {session.session_id.slice(0, 8)}… started for {session.exam};
            events persist to the database as they finish
          </p>
        )}
      </Panel>

      {session && consent === true && <LiveSession sessionToken={session.session_token} />}
    </>
  )
}
