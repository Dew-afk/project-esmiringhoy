import { useState } from 'react'
import { Panel, Banner, Empty, Field } from '../ui.jsx'

const SAMPLE_SESSIONS = [
  { id: 'sess_0001', student: 'sample student a', exam: 'midterm 1', risk: 0.31, flags: 3, state: 'in progress' },
  { id: 'sess_0002', student: 'sample student b', exam: 'midterm 1', risk: 0.12, flags: 1, state: 'completed' },
]

const SAMPLE_FLAGS = [
  { id: 'ev_0001', at: '00:20.2', type: 'unauthorized_object', severity: 'high', note: '', override: null },
  { id: 'ev_0002', at: '00:38.4', type: 'head_pose_deviation', severity: 'medium', note: '', override: null },
  { id: 'ev_0003', at: '00:52.7', type: 'gaze_deviation', severity: 'medium', note: '', override: null },
]

export default function Dashboard() {
  const [session, setSession] = useState(null)
  const [flags, setFlags] = useState(SAMPLE_FLAGS)
  const [selected, setSelected] = useState([])
  const [escalateFor, setEscalateFor] = useState(null)

  const setNote = (id, note) => setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, note } : f)))
  const setOverride = (id, override) => setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, override } : f)))
  const dismiss = (id) => setFlags((fs) => fs.filter((f) => f.id !== id))

  const bulkable = flags.filter((f) => selected.includes(f.id) && f.severity === 'low' && !f.override)
  const bulkDismiss = () => {
    setFlags((fs) => fs.filter((f) => !selected.includes(f.id)))
    setSelected([])
  }

  return (
    <>
      <Banner>
        <b>backend not connected:</b> the rows below are sample layout, not real records. every action here is a
        placeholder until the api and audit log exist
      </Banner>
      <Panel title="active sessions">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>session</th><th>student</th><th>exam</th>
                <th>risk score (advisory)</th><th>flags</th><th>state</th><th></th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_SESSIONS.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td><td>{s.student}</td><td>{s.exam}</td>
                  <td className="num">{s.risk.toFixed(2)}</td>
                  <td className="num">{s.flags}</td>
                  <td><span className={`chip chip-${s.state === 'in progress' ? 'in-progress' : 'completed'}`}>{s.state}</span></td>
                  <td><button className="btn small ghost" onClick={() => setSession(s)}>open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Empty>no sessions: the list fills from the stream processor, nothing is invented here</Empty>
      </Panel>

      {session && (
        <Panel title={`review: ${session.id}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 'var(--text-title)', fontVariantNumeric: 'tabular-nums' }}>
              risk {session.risk.toFixed(2)}
            </span>
            <span className="chip chip-in-progress">advisory, not a finding</span>
            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>no code path sets a cheating outcome automatically</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>select</th><th>at</th><th>event</th><th>severity</th>
                  <th>override (original kept)</th><th>note</th><th>actions</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td><input type="checkbox" aria-label={`select ${f.type}`}
                          checked={selected.includes(f.id)}
                          onChange={(e) => setSelected((sel) => e.target.checked ? [...sel, f.id] : sel.filter((x) => x !== f.id))} /></td>
                    <td className="num">{f.at}</td>
                    <td>{f.type}</td>
                    <td><span className={`leg sev-${f.severity}`}>
                      {f.severity === 'critical' && <span className="sev-mark" aria-hidden="true">!</span>}
                      {f.severity}
                    </span></td>
                    <td>
                      <select className="select" style={{ height: 28, fontSize: 'var(--text-label)' }}
                        value={f.override || ''}
                        onChange={(e) => setOverride(f.id, e.target.value || null)} aria-label={`override severity for ${f.type}`}>
                        <option value="">keep {f.severity}</option>
                        {['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="input" style={{ height: 28, fontSize: 'var(--text-label)' }}
                        placeholder="reviewer note" value={f.note} onChange={(e) => setNote(f.id, e.target.value)}
                        aria-label={`note for ${f.type}`} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn small ghost" onClick={() => setEscalateFor(f.id)}>escalate</button>
                        <button className="btn small ghost" onClick={() => dismiss(f.id)}>acknowledge</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {escalateFor && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Banner>escalating {flags.find((f) => f.id === escalateFor)?.type}: a case gets a recording reference and risk context (placeholder)</Banner>
              <div className="formrow">
                <Field id="esc-ref" label="recording reference">
                  <input className="input" id="esc-ref" placeholder="rec_0001 placeholder" />
                </Field>
                <Field id="esc-context" label="risk context">
                  <input className="input" id="esc-context" placeholder="what the proctor saw" />
                </Field>
                <button className="btn" onClick={() => setEscalateFor(null)}>create case (placeholder)</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button className="btn small danger" disabled={!bulkable.length} onClick={bulkDismiss}>
              bulk-dismiss {bulkable.length} low, same session
            </button>
            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
              bulk-dismiss applies to low severity only, same type, same session, and logs every row
            </span>
          </div>
        </Panel>
      )}

      <div className="grid" style={{ marginTop: 16 }}>
        <Panel title="ai summary (advisory)">
          <span className="chip chip-in-progress">advisory, separate from raw flags</span>
          <Empty>summaries arrive from the llm service with model version and timestamps: nothing is generated or invented here</Empty>
        </Panel>
        <Panel title="playback and export">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn ghost" disabled>export recording</button>
            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
              needs object storage and a presigned url; exports are role and institution checked and
              audit logged; unavailable when never captured, purged or corrupt
            </span>
          </div>
        </Panel>
      </div>
    </>
  )
}
