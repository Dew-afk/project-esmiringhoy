import { useState } from 'react'
import { Panel, Banner, Empty } from '../ui.jsx'

export default function DbViewer() {
  const [confirm, setConfirm] = useState(false)
  const [institution, setInstitution] = useState('Test Institution')

  return (
    <>
      <Banner>
        <b>database viewer placeholder:</b> read-only and scoped to the institution; deletion is guarded to the
        Test Institution with a confirmation step, and every attempt is logged
      </Banner>
      <Panel title="institution scope">
        <div className="formrow">
          <select className="select" aria-label="institution scope" value={institution}
            onChange={(e) => setInstitution(e.target.value)}>
            <option value="Test Institution">Test Institution</option>
          </select>
          <span style={{ color: 'var(--t-detail-80)', fontSize: 'var(--text-data)' }}>
            cross-institution access is denied and logged by the backend
          </span>
        </div>
      </Panel>
      <Panel title="mock and test data">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>table</th><th>rows</th><th>deletion</th></tr>
            </thead>
            <tbody>
              <tr><td>EventsFlags</td><td className="num">sample</td><td>guarded</td></tr>
              <tr><td>RiskScores</td><td className="num">sample</td><td>guarded</td></tr>
              <tr><td>AuditLog</td><td className="num">sample</td><td>blocked, never deletable</td></tr>
              <tr><td>RetentionLog</td><td className="num">sample</td><td>blocked, never deletable</td></tr>
              <tr><td>Consents</td><td className="num">sample</td><td>blocked, never deletable</td></tr>
            </tbody>
          </table>
        </div>
        <Empty>rows are sample layout: the real viewer reads through a role-checked api</Empty>
      </Panel>
      <Panel title="guarded delete">
        {!confirm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="btn danger" disabled={institution !== 'Test Institution'}
              onClick={() => setConfirm(true)}>delete mock and test data</button>
            {institution !== 'Test Institution' && (
              <span style={{ color: 'var(--t-detail-80)', fontSize: 'var(--text-data)' }}>
                deletion is available in the Test Institution only
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Banner>this deletes only the Test Institution's data. the attempt and the outcome are written to the audit log before anything is removed (placeholder, nothing is deleted yet)</Banner>
            <div className="formrow">
              <button className="btn danger" onClick={() => setConfirm(false)}>confirm delete (placeholder)</button>
              <button className="btn ghost" onClick={() => setConfirm(false)}>cancel</button>
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}
