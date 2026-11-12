import { useEffect, useState } from 'react'
import { ROLES } from '../auth.jsx'
import { authApi } from '../api.js'
import '../signin.css'

const DEV_MODE = import.meta.env.DEV

// UI role names (auth.jsx) <-> API role names (backend RegisterBody / user_role enum)
const API_ROLE = {
  student: 'student',
  proctor: 'instructor',
  admin: 'admin',
  'appeals reviewer': 'appeals_reviewer',
}
const UI_ROLE = Object.fromEntries(Object.entries(API_ROLE).map(([ui, api]) => [api, ui]))

const PILL_TRANSFORMS = [
  'translate(0, 0)',
  'translate(calc(100% + 8px), 0)',
  'translate(0, calc(100% + 8px))',
  'translate(calc(100% + 8px), calc(100% + 8px))',
]

function BrandHeader() {
  return (
    <header className="signin-head">
      <span className="signin-wordmark">AIsmering</span>
    </header>
  )
}

function GlassCard({ children }) {
  return <div className="glass-card">{children}</div>
}

function RoleSelector({ role, setRole }) {
  const index = ROLES.findIndex(([v]) => v === role)
  return (
    <div>
      <span className="field-label" id="role-label">account type</span>
      <div className="role-group" role="radiogroup" aria-labelledby="role-label">
        <span className="role-pill" aria-hidden="true" style={{ transform: PILL_TRANSFORMS[index] }}></span>
        {ROLES.map(([value, label]) => (
          <label key={value} className={`role-opt ${role === value ? 'selected' : ''}`}>
            <input type="radio" name="role" value={value}
              checked={role === value} onChange={() => setRole(value)} />
            <span className="role-check" aria-hidden="true">
              {role === value && (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
                </svg>
              )}
            </span>
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function TextField({ id, label, type = 'text', placeholder, value, onChange, autoComplete, hint, showHint, onFocus, onBlur }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input className="input" id={id} type={type} placeholder={placeholder} value={value}
        onChange={onChange} autoComplete={autoComplete} onFocus={onFocus} onBlur={onBlur}
        aria-describedby={showHint && hint ? `${id}-hint` : undefined} />
      {showHint && hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  )
}

function PasswordField({ id = 'signin-password', label = 'password', password, setPassword, show, setShow, autoComplete = 'current-password' }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="pwd">
        <input className="input" id={id} type={show ? 'text' : 'password'}
          autoComplete={autoComplete} placeholder="password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <button type="button" className="pwd-toggle" aria-pressed={show}
          aria-label={show ? 'hide password' : 'show password'}
          onClick={() => setShow(!show)}>
          {show ? 'hide' : 'show'}
        </button>
      </div>
    </div>
  )
}

function FormMessage({ message }) {
  const kind = message?.kind === 'note' ? 'Note:' : message ? 'Error:' : null
  return (
    <div className="form-message" role="status" aria-live="polite">
      {message && (
        <span className="msg">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4M8 11.2v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {kind} {message.text}
        </span>
      )}
    </div>
  )
}

function TenantSelect({ tenant, setTenant }) {
  const [names, setNames] = useState([])
  useEffect(() => {
    fetch('/api/institutions')
      .then((r) => r.json())
      .then((d) => {
        const list = d.institutions || []
        setNames(list)
        if (list.length && !list.includes(tenant)) setTenant(list[0])
      })
      .catch(() => {})
  }, [])
  return (
    <div>
      <label className="field-label" htmlFor="signin-tenant">institution</label>
      <select className="select" id="signin-tenant" value={tenant} onChange={(e) => setTenant(e.target.value)}>
        {names.length === 0 && <option value={tenant}>{tenant}</option>}
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  )
}

export default function SignInPage({ onEnter }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'register'
  const [role, setRole] = useState('student') // form variant only, never the role itself
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [tenant, setTenant] = useState('Test Institution')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  // register-only fields
  const [fullName, setFullName] = useState('')
  const [institution, setInstitution] = useState('Test Institution')
  const [confirm, setConfirm] = useState('')
  const [rosterId, setRosterId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [department, setDepartment] = useState('')
  const [consent, setConsent] = useState(false)

  const error = (text) => setMessage({ text, kind: 'error' })
  const note = (text) => setMessage({ text, kind: 'note' })

  const submitSignin = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const data = await authApi.login({
        email, password,
        institution: role === 'admin' ? tenant : undefined,
      })
      // the role comes from the server's account record, never the selector
      onEnter(UI_ROLE[data.role] || data.role)
    } catch (err) {
      if (err instanceof TypeError && DEV_MODE) {
        // backend unreachable: dev-only seeding, off in production builds
        onEnter(role)
        return
      }
      error(err.detail || 'sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const submitRegister = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      error('passwords do not match')
      return
    }
    if (role === 'student' && !consent) {
      error('biometric-monitoring consent is required')
      return
    }
    setBusy(true)
    try {
      await authApi.register({
        email, password, full_name: fullName, role: API_ROLE[role], institution,
        roster_id: role === 'student' ? rosterId || null : null,
        staff_id: role === 'proctor' ? staffId || null : null,
        department: role === 'proctor' ? department || null : null,
        consent: role === 'student' ? consent : null,
      })
      note('account created, sign in')
      setMode('signin')
    } catch (err) {
      error(err.detail || 'registration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <div className="dot-grid" aria-hidden="true"></div>
      <div className="orb orb-a" aria-hidden="true"></div>
      <div className="orb orb-b" aria-hidden="true"></div>
      <div className="orb orb-c" aria-hidden="true"></div>
      <BrandHeader />
      <main className="signin-main">
        <GlassCard>
          {mode === 'signin' ? (
            <form onSubmit={submitSignin} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <h1>Sign in to AIsmering</h1>
                <p className="tagline">AI flags the moments. A person makes the call.</p>
              </div>
              <RoleSelector role={role} setRole={setRole} />
              <span className="hint" style={{ marginTop: 0 }}>
                this only changes the form (the server assigns your real role from your account)
              </span>
              {role === 'admin' && <TenantSelect tenant={tenant} setTenant={setTenant} />}
              <TextField id="signin-email" label="email" type="email"
                placeholder="you@institution.edu" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <PasswordField password={password} setPassword={setPassword} show={show} setShow={setShow} />
              <FormMessage message={message} />
              <div>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'signing in…' : 'Sign in'}
                </button>
                {DEV_MODE && (
                  <span className="hint" style={{ marginTop: 0, textAlign: 'center' }}>
                    dev-only: if the api is down, this demo enters you as {role}
                  </span>
                )}
                <div className="linkrow" style={{ marginTop: 8 }}>
                  <button type="button" className="link" onClick={() => error('password reset is not connected yet')}>
                    Forgot password?
                  </button>
                  <button type="button" className="link" onClick={() => { setMode('register'); setMessage(null) }}>
                    Register
                  </button>
                </div>
              </div>
              <div className="divider">or</div>
              <button type="button" className="btn btn-secondary"
                onClick={() => error('institution sso (saml or oauth) is not connected yet')}>
                Continue with Institution SSO
              </button>
            </form>
          ) : (
            <form onSubmit={submitRegister} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <h1>Create your account</h1>
                <p className="tagline">Registration is enforced by the server, including consent.</p>
              </div>
              <RoleSelector role={role} setRole={setRole} />
              <TextField id="reg-name" label="full name" placeholder="your name"
                value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              <TextField id="reg-email" label="email" type="email"
                placeholder="you@institution.edu" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <TextField id="reg-institution" label="institution" placeholder="institution name"
                value={institution} onChange={(e) => setInstitution(e.target.value)} />
              {role === 'student' && (
                <>
                  <TextField id="reg-roster" label="roster id" placeholder="R-0000"
                    value={rosterId} onChange={(e) => setRosterId(e.target.value)} />
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-data)' }}>
                    <input type="checkbox" id="reg-consent" checked={consent}
                      onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 4 }} />
                    <span>I agree to biometric monitoring during the exam (required)</span>
                  </label>
                </>
              )}
              {role === 'proctor' && (
                <>
                  <TextField id="reg-staff" label="staff id" placeholder="S-000"
                    value={staffId} onChange={(e) => setStaffId(e.target.value)} />
                  <TextField id="reg-dept" label="department" placeholder="e.g. computer science"
                    value={department} onChange={(e) => setDepartment(e.target.value)} />
                </>
              )}
              <PasswordField id="reg-password" label="password" password={password} setPassword={setPassword}
                show={show} setShow={setShow} autoComplete="new-password" />
              <PasswordField id="reg-confirm" label="confirm password" password={confirm} setPassword={setConfirm}
                show={show} setShow={setShow} autoComplete="new-password" />
              <FormMessage message={message} />
              <div>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'creating account…' : 'Create account'}
                </button>
                <div className="linkrow" style={{ marginTop: 8 }}>
                  <span></span>
                  <button type="button" className="link" onClick={() => { setMode('signin'); setMessage(null) }}>
                    Back to sign in
                  </button>
                </div>
              </div>
            </form>
          )}
        </GlassCard>
      </main>
    </div>
  )
}
