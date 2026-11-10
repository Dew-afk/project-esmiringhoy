import { useState } from 'react'
import { Panel, Banner, Empty, Field } from '../ui.jsx'

const LIFECYCLE = ['draft', 'scheduled', 'in progress', 'completed', 'archived']
const CHIP = { draft: 'chip-draft', scheduled: 'chip-scheduled', 'in progress': 'chip-in-progress',
               completed: 'chip-completed', archived: 'chip-archived' }

const TABS = ['exams', 'policy templates', 'rosters', 'accounts']

export default function Admin() {
  const [tab, setTab] = useState('exams')
  const [lifecycle, setLifecycle] = useState('draft')

  return (
    <>
      <Banner>
        <b>admin console placeholder:</b> forms validate and go nowhere yet, real apis and server-side authorization
        arrive with the backend, nothing here persists
      </Banner>
      <div className="tabs" role="tablist" aria-label="admin sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'exams' && (
        <>
          <Panel title="exam: create or edit (placeholder)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="formrow">
                <Field id="exam-name" label="name">
                  <input className="input" id="exam-name" placeholder="midterm 1" />
                </Field>
                <Field id="exam-window" label="window">
                  <input className="input" id="exam-window" placeholder="oct 30 09:00 to 11:00" />
                </Field>
                <Field id="exam-duration" label="duration">
                  <input className="input" id="exam-duration" placeholder="120 min" />
                </Field>
                <Field id="exam-materials" label="allowed materials">
                  <input className="input" id="exam-materials" placeholder="none, calculator, one sheet of notes" />
                </Field>
              </div>
              <div className="formrow">
                <Field id="exam-lifecycle" label="lifecycle">
                  <select className="select" id="exam-lifecycle" value={lifecycle}
                    onChange={(e) => setLifecycle(e.target.value)}>
                    {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <span className={`chip ${CHIP[lifecycle]}`}>{lifecycle}</span>
                <button className="btn">save (placeholder)</button>
              </div>
              <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
                state machine: draft to scheduled to in progress to completed to archived, transitions enforced by the backend
              </span>
            </div>
          </Panel>
          <Panel title="exams">
            <Empty>no exams yet: rows come from the exam service, not from this placeholder</Empty>
          </Panel>
        </>
      )}

      {tab === 'policy templates' && (
        <Panel title="policy templates">
          <Empty>policy templates mirror policy.yaml in the backend (pose_v2, conf 0.35, imgsz 960): the list is a placeholder</Empty>
        </Panel>
      )}

      {tab === 'rosters' && (
        <Panel title="rosters with accommodations">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>student</th><th>exam</th><th>accommodations</th></tr>
              </thead>
              <tbody>
                <tr><td>sample student a</td><td>midterm 1</td><td>extra time 50%</td></tr>
              </tbody>
            </table>
          </div>
          <Empty>csv and sis import are a change request, not built; this row is sample layout</Empty>
        </Panel>
      )}

      {tab === 'accounts' && (
        <Panel title="accounts, four roles">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>name</th><th>role</th><th>institution</th></tr>
              </thead>
              <tbody>
                <tr><td>sample proctor</td><td>instructor, proctor</td><td>test institution</td></tr>
                <tr><td>sample reviewer</td><td>appeals reviewer</td><td>test institution</td></tr>
              </tbody>
            </table>
          </div>
          <Empty>role checks (rbac) are backend enforced and tested per role: this table is sample layout</Empty>
        </Panel>
      )}
    </>
  )
}
