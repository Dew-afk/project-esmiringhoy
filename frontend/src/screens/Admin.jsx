import { useCallback, useEffect, useState } from 'react'
import { Panel, Banner, Empty, Field } from '../ui.jsx'
import { adminApi } from '../api.js'

const LIFECYCLE = ['draft', 'scheduled', 'in progress', 'completed', 'archived']
const CHIP = { draft: 'chip-draft', scheduled: 'chip-scheduled', 'in progress': 'chip-in-progress',
               completed: 'chip-completed', archived: 'chip-archived' }

const TABS = ['exams', 'policy templates', 'rosters', 'accounts']

export default function Admin() {
  const [tab, setTab] = useState('exams')
  const [lifecycle, setLifecycle] = useState('draft')
  const [accounts, setAccounts] = useState(null)
  const [acctStatus, setAcctStatus] = useState('pending')
  const [acctError, setAcctError] = useState(null)
  const [created, setCreated] = useState(null) // {email, role, temp_password}
  const [form, setForm] = useState({ email: '', full_name: '', role: 'appeals_reviewer' })
  const [busy, setBusy] = useState(false)

  const loadAccounts = useCallback(() => {
    adminApi.accounts(acctStatus)
      .then((d) => { setAccounts(d.accounts); setAcctError(null) })
      .catch((e) => setAcctError(e.detail || 'could not load accounts'))
  }, [acctStatus])

  useEffect(() => { if (tab === 'accounts') loadAccounts() }, [tab, loadAccounts])

  const act = async (fn) => {
    setBusy(true)
    try { await fn(); loadAccounts() } catch (e) { setAcctError(e.detail || 'action failed') }
    finally { setBusy(false) }
  }

  const create = () => {
    setBusy(true)
    setAcctError(null)
    adminApi.create(form)
      .then((d) => { setCreated(d); setForm({ email: '', full_name: '', role: 'appeals_reviewer' }); loadAccounts() })
      .catch((e) => setAcctError(e.detail || 'create failed'))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Banner>
        <b>admin console:</b> the accounts tab is live (pending approvals, provisioning,
        audit-logged). exams, policies and rosters are placeholders until the exam service exists
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
        <>
          {acctError && <Banner><b>error:</b> {acctError}</Banner>}
          {created && (
            <Banner>
              <b>account created — temporary password (shown once, not stored):</b>{' '}
              {created.email} / {created.temp_password}. share it securely; it cannot be retrieved again.
            </Banner>
          )}
          <Panel title="accounts">
            <div className="formrow" style={{ marginBottom: 12 }}>
              <Field id="acct-filter" label="show">
                <select className="select" id="acct-filter" value={acctStatus}
                  onChange={(e) => setAcctStatus(e.target.value)}>
                  <option value="pending">pending</option>
                  <option value="approved">approved</option>
                  <option value="disabled">disabled</option>
                  <option value="all">all</option>
                </select>
              </Field>
            </div>
            {accounts === null ? (
              <Empty>loading…</Empty>
            ) : accounts.length === 0 ? (
              <Empty>no pending accounts in your institution</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>name</th><th>email</th><th>role</th><th>requested</th><th></th></tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.full_name}</td><td>{a.email}</td>
                        <td>{a.role}</td>
                        <td style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
                          {new Date(a.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {a.approval_status === 'pending' && (
                              <button className="btn small" disabled={busy}
                                onClick={() => act(() => adminApi.approve(a.id))}>approve</button>
                            )}
                            {a.approval_status !== 'disabled' && (
                              <button className="btn small danger" disabled={busy}
                                onClick={() => act(() => adminApi.disable(a.id))}>disable</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
              approve lets a pending proctor sign in; disable blocks sign-in. both are audit-logged
            </span>
          </Panel>

          <Panel title="create account (admin or appeals reviewer)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="formrow">
                <Field id="acct-email" label="email">
                  <input className="input" id="acct-email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field id="acct-name" label="full name">
                  <input className="input" id="acct-name" value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </Field>
                <Field id="acct-role" label="role">
                  <select className="select" id="acct-role" value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="appeals_reviewer">appeals reviewer</option>
                    <option value="admin">admin</option>
                  </select>
                </Field>
              </div>
              <div className="formrow">
                <button className="btn" disabled={busy || !form.email || !form.full_name} onClick={create}>
                  create account
                </button>
                <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
                  students and proctors self-register; admins and appeals reviewers are provisioned here.
                  a one-time temporary password is returned once
                </span>
              </div>
            </div>
          </Panel>
        </>
      )}
    </>
  )
}
