import { useState } from 'react'
import { Panel, Banner } from '../ui.jsx'
import LiveSession from '../LiveSession.jsx'

export default function Student() {
  const [consent, setConsent] = useState(false)
  const [checked, setChecked] = useState(false)

  return (
    <>
      <Banner>
        <b>student console placeholder:</b> consent, session start and the exam timer are enforced by the backend,
        the device check below is the real live camera screen
      </Banner>
      <Panel title="consent">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-data)' }}>
            <input type="checkbox" id="consent-box" checked={checked}
              onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 4 }} />
            <span>I agree to session recording and monitoring. revocation is enforced by the backend, no session starts without this.</span>
          </label>
          <div className="formrow">
            <button className="btn" disabled={!checked} onClick={() => setConsent(true)}>grant consent (placeholder)</button>
            <button className="btn ghost" disabled={!consent} onClick={() => setConsent(false)}>revoke (placeholder)</button>
          </div>
          <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>
            consent state here: {consent ? 'granted (placeholder, nothing persisted)' : 'not granted'}
          </span>
        </div>
      </Panel>
      {consent && (
        <>
          <Panel title="exam session">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <span className="chip chip-in-progress">in progress</span>
              <span className="num" style={{ fontSize: 'var(--text-title)', fontVariantNumeric: 'tabular-nums' }}>60:00</span>
              <span style={{ color: 'var(--dim)', fontSize: 'var(--text-data)' }}>exam timer placeholder, owned by the exam service</span>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost small">request tech support (placeholder, proctoring continues)</button>
            </div>
            <p style={{ color: 'var(--dim)', fontSize: 'var(--text-data)', margin: '12px 0 0' }}>
              non-punitive notice area: deviations are flagged for human review, never marked as cheating
            </p>
          </Panel>
          <LiveSession />
        </>
      )}
    </>
  )
}
