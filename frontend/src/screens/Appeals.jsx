import { useEffect, useState } from 'react'
import { Panel, Banner, Empty } from '../ui.jsx'
import { appealsApi } from '../api.js'

const fmtAt = (s) => {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

// Option A, minimal (SDD 4.3): read-only access to escalated items.
// Case notes, decisions and the Case entity need a change request first.
export default function Appeals() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    appealsApi.escalated()
      .then((d) => { setRows(d.escalated); setError(null) })
      .catch((e) => setError(e.detail || 'could not load escalations'))
  }, [])

  return (
    <>
      {error && <Banner><b>error:</b> {error}</Banner>}
      <Banner>
        <b>read-only lane:</b> escalated events appear here with their flags, notes,
        recording reference and risk context. no dismiss, override, delete or
        case-decision controls exist in this role
      </Banner>
      <Panel title="escalated events">
        <span className="chip chip-draft">read-only</span>
        {rows === null ? (
          <Empty>loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            no escalations yet. when a proctor escalates a flag, it appears here
            for review, and nothing here can change it
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>when</th><th>exam</th><th>student</th><th>event</th>
                  <th>severity</th><th>note</th><th>recording ref</th><th>risk (advisory)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.event_id}>
                    <td className="num">{fmtAt(r.start_s)}</td>
                    <td>{r.exam}</td>
                    <td>{r.student}</td>
                    <td>{r.event_type}</td>
                    <td>{r.severity_override || r.severity}</td>
                    <td style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>{r.review_note || '—'}</td>
                    <td style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>{r.escalation_recording_ref || '—'}</td>
                    <td className="num">{r.risk_score != null ? Number(r.risk_score).toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
