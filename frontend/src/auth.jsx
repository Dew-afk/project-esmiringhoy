import { createContext, useContext, useState } from 'react'

// The four roles, one constant shared by the sign-in form and the docs.
export const ROLES = [
  ['student', 'Student'],
  ['proctor', 'Proctor'],
  ['admin', 'Admin'],
  ['appeals reviewer', 'Appeals Reviewer'],
]

// Role-to-screen table: the single source for nav, routes and guards.
// Mirrors docs/ROLES.md. A role absent here has no screens.
export const ROLE_PERMS = {
  student: ['#/student'],
  proctor: ['#/dashboard', '#/reports', '#/db'],
  admin: ['#/dashboard', '#/admin', '#/reports', '#/db'],
  'appeals reviewer': ['#/appeals'],
}

export const DEFAULT_ROUTE = {
  student: '#/student',
  proctor: '#/dashboard',
  admin: '#/dashboard',
  'appeals reviewer': '#/appeals',
}

export const ROUTE_LABELS = {
  '#/student': 'student',
  '#/dashboard': 'proctor',
  '#/admin': 'admin',
  '#/reports': 'reports',
  '#/db': 'db viewer',
  '#/appeals': 'appeals',
}

const AuthContext = createContext(null)

export function AuthProvider({ children, initial = {} }) {
  // role comes from the account, not from the client. Until the backend
  // assigns it, a DEV-only switcher (SignInPage) may seed it.
  const [auth, setAuth] = useState({
    role: initial.role || 'none',
    signedIn: initial.signedIn || false,
  })

  const enter = (role) => setAuth({ role, signedIn: true })

  return <AuthContext.Provider value={{ ...auth, enter }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function allowedRoutes(role) {
  return ROLE_PERMS[role] || []
}

export function NotAuthorised({ role, route }) {
  return (
    <section className="glass panel" role="status">
      <h2>not authorised</h2>
      <p className="e-none">
        role {role} cannot open {ROUTE_LABELS[route] || route}. the server enforces
        this once authentication exists.
      </p>
    </section>
  )
}

// Guards one route: renders the screen or the not-authorised state, never a blank page.
export function RequireRole({ route, children }) {
  const { role } = useAuth()
  if (!allowedRoutes(role).includes(route)) {
    return <NotAuthorised role={role} route={route} />
  }
  return children
}
