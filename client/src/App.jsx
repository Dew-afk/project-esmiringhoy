import { useEffect, useState } from 'react'
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

export default function App() {
  const [hash, setHash] = useState(location.hash || '#/student')
  const [role, setRole] = useState('none')
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const onChange = () => setHash(location.hash || '#/student')
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])

  // role navigation is hidden until a user is signed in: the sign-in page
  // replaces the whole shell, not just one route
  if (!signedIn) {
    return <SignInPage onEnter={(r) => {
      setRole(r)
      setSignedIn(true)
      location.hash = r === 'student' ? '#/student' : '#/dashboard'
    }} />
  }

  const [route, , Screen] = ROUTES.find(([h]) => h === hash) || ROUTES[0]

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
        {ROUTES.map(([h, text]) => (
          <a key={h} href={h} className={h === hash ? 'active' : ''}>{text}</a>
        ))}
      </nav>

      <main>
        <Screen />
      </main>
    </>
  )
}
