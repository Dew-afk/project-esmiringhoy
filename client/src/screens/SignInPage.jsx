import { useState } from 'react'
import '../signin.css'

const DEV_MODE = import.meta.env.DEV

const ROLES = [
  ['student', 'Student'],
  ['proctor', 'Proctor'],
  ['admin', 'Admin'],
  ['appeals reviewer', 'Appeals Reviewer'],
]

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
      <span className="field-label" id="role-label">role</span>
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

function PasswordField({ password, setPassword, show, setShow }) {
  return (
    <div>
      <label className="field-label" htmlFor="signin-password">password</label>
      <div className="pwd">
        <input className="input" id="signin-password" type={show ? 'text' : 'password'}
          autoComplete="current-password" placeholder="password" value={password}
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

function PrimaryButton({ onClick }) {
  return <button type="submit" className="btn btn-primary" onClick={onClick}>Sign in</button>
}

function SecondaryButton({ onClick }) {
  return (
    <button type="button" className="btn btn-secondary" onClick={onClick}>
      Continue with Institution SSO
    </button>
  )
}

function TenantSelect() {
  return (
    <div className="tenant-enter">
      <label className="field-label" htmlFor="signin-tenant">institution</label>
      <select className="select" id="signin-tenant">
        <option value="test institution">test institution</option>
      </select>
    </div>
  )
}

export default function SignInPage({ onEnter }) {
  const [role, setRole] = useState('student')
  const [email, setEmail] = useState('')
  const [emailFocused, setEmailFocused] = useState(false)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [message, setMessage] = useState(null)

  const note = (text) => setMessage({ text, kind: 'note' })
  const error = (text) => setMessage({ text, kind: 'error' })

  const submit = (e) => {
    e.preventDefault()
    onEnter(role) // stub: no auth call, no success claim
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
          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <h1>Sign in to AIsmering</h1>
              <p className="tagline">AI flags the moments. A person makes the call.</p>
            </div>
            <RoleSelector role={role} setRole={setRole} />
            {role === 'admin' && <TenantSelect />}
            <TextField id="signin-email" label="email" type="email"
              placeholder="you@institution.edu" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              hint="your institution email" showHint={emailFocused}
              onFocus={() => setEmailFocused(true)} onBlur={() => setEmailFocused(false)} />
            <PasswordField password={password} setPassword={setPassword} show={show} setShow={setShow} />
            <FormMessage message={message} />
            <PrimaryButton />
            <div className="linkrow">
              <button type="button" className="link" onClick={() => error('password reset is not connected yet')}>
                Forgot password?
              </button>
              <button type="button" className="link" onClick={() => error('registration is not connected yet')}>
                Register
              </button>
            </div>
            <div className="divider">or</div>
            <SecondaryButton onClick={() => error('institution sso (saml or oauth) is not connected yet')} />
            {DEV_MODE && (
              <p className="demo-note"><b>Note:</b> sign-in is not connected yet. Role selection is a demo only.</p>
            )}
          </form>
        </GlassCard>
      </main>
    </div>
  )
}
