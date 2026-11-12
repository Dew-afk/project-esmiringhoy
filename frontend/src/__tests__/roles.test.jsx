import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ROLE_PERMS, DEFAULT_ROUTE } from '../auth.jsx'
import App, { ROUTES } from '../App.jsx'

// UI tests only: they prove the frontend shows each role its permitted
// nav and blocks denied routes. They do NOT prove server-side RBAC.

afterEach(() => {
  cleanup()
  location.hash = ''
})

const NAV_LABELS = {
  '#/student': 'student',
  '#/dashboard': 'proctor',
  '#/admin': 'admin',
  '#/reports': 'reports',
  '#/db': 'db viewer',
  '#/appeals': 'appeals',
}

const renderAs = (role, hash) => {
  location.hash = hash
  return render(<App initialAuth={{ role, signedIn: true }} />)
}

const navTexts = () =>
  within(screen.getByRole('navigation', { name: 'primary' }))
    .getAllByRole('link')
    .map((a) => a.textContent)

describe('role navigation', () => {
  it('each role sees only its permitted nav items', () => {
    const expected = {
      student: ['student'],
      proctor: ['proctor', 'reports', 'db viewer'],
      admin: ['proctor', 'admin', 'reports', 'db viewer'],
      'appeals reviewer': ['appeals'],
    }
    for (const [role, labels] of Object.entries(expected)) {
      renderAs(role, DEFAULT_ROUTE[role])
      expect(navTexts().sort()).toEqual(labels.sort())
      cleanup()
    }
  })

  it('a denied route renders not authorised, never a blank page', () => {
    renderAs('student', '#/dashboard')
    expect(screen.getByText('not authorised')).toBeTruthy()
    expect(screen.queryByText('active sessions')).toBeNull()
    cleanup()
    renderAs('appeals reviewer', '#/db')
    expect(screen.getByText('not authorised')).toBeTruthy()
  })
})

describe('appeals reviewer', () => {
  it('has no mutating controls and shows the read-only label', () => {
    renderAs('appeals reviewer', '#/appeals')
    expect(screen.getByText('read-only')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /dismiss|override|delete|confirm|decision|escalate/i })).toBeNull()
  })
})

describe('permission table', () => {
  it('covers every route', () => {
    const granted = new Set(Object.values(ROLE_PERMS).flat())
    for (const [route] of ROUTES) {
      expect(granted.has(route)).toBe(true)
    }
    expect(Object.keys(NAV_LABELS).sort()).toEqual(ROUTES.map(([h]) => h).sort())
  })
})
