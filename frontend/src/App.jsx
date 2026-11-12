import { useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth, RequireRole, allowedRoutes, DEFAULT_ROUTE, ROUTE_LABELS } from './auth.jsx'
import SignInPage from './screens/SignInPage.jsx'
import Student from './screens/Student.jsx'
import Dashboard from './screens/Dashboard.jsx'
import Admin from './screens/Admin.jsx'
import Appeals from './screens/Appeals.jsx'
import Reports from './screens/Reports.jsx'
import DbViewer from './screens/DbViewer.jsx'

const DEV_MODE = import.meta.env.DEV

const ROUTES = [
  ['#/student', 'student', Student],
  ['#/dashboard', 'proctor', Dashboard],
  ['#/admin', 'admin', Admin],
  ['#/appeals', 'appeals', Appeals],
  ['#/reports', 'reports', Reports],
  ['#/db', 'db viewer', DbViewer],
]

export { ROUTES }

function Shell() {
  const { role, signedIn, enter } = useAuth()
  const [hash, setHash] = useState(location.hash || DEFAULT_ROUTE[role] || '#/dashboard')

  useEffect(() => {
    const onChange = () => setHash(location.hash || DEFAULT_ROUTE[role] || '#/dashboard')
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [role])

  // after a sign-in transition, the role's default route takes over if the
  // hash captured while signed out is not one this role may open
  const wasSignedIn = useRef(signedIn)
  useEffect(() => {
    if (signedIn && !wasSignedIn.current) {
      setHash((current) =>
        allowedRoutes(role).includes(current) ? current : (DEFAULT_ROUTE[role] || '#/dashboard'))
    }
    wasSignedIn.current = signedIn
  }, [signedIn, role])

  // sign-in gate: the whole shell is replaced until the backend signs a role in
  if (!signedIn) {
    return <SignInPage onEnter={enter} />
  }

  // nav and routes come from the one permission table; a denied route
  // renders "not authorised", never a blank page
  const allowed = allowedRoutes(role)
  const nav = ROUTES.filter(([h]) => allowed.includes(h))
  const fallback = DEFAULT_ROUTE[role] || '#/dashboard'
  const [route, , Screen] = ROUTES.find(([h]) => h === hash) || [fallback, ROUTE_LABELS[fallback], nav[0]?.[2]]

  return (
    <>
      <div className="dot-grid" aria-hidden="true"></div>
      <div className="orb orb-a" aria-hidden="true"></div>
      <div className="orb orb-b" aria-hidden="true"></div>
      <div className="orb orb-c" aria-hidden="true"></div>
      <header className="top">
        <div className="brand">
          <div className="wordmark">AIsmering</div>
          <div className="submark">proctor console</div>
        </div>
        <div className="chips">
          <span className="hchip">role: {role}</span>
          {DEV_MODE && <span className="hchip">backend not connected</span>}
        </div>
      </header>

      <nav className="nav" aria-label="primary">
        {nav.map(([h, text]) => (
          <a key={h} href={h} className={h === hash ? 'active' : ''}>{text}</a>
        ))}
      </nav>

      <main>
        <RequireRole route={hash}>
          <Screen />
        </RequireRole>
      </main>
    </>
  )
}

export default function App({ initialAuth } = {}) {
  return (
    <AuthProvider initial={initialAuth}>
      <Shell />
    </AuthProvider>
  )
}
