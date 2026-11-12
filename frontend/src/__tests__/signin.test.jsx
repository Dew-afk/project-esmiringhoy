import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App.jsx'

// C-layer: mocked-fetch UI tests. They prove the form logic and error
// display; they do NOT hit a real server (that's the A-layer's job).

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  location.hash = ''
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const fill = (label, value) => {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
}

describe('sign-in and register forms (mocked fetch)', () => {
  it('register without consent is blocked client-side and never calls the api', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('Register'))
    fill('full name', 'Test Student')
    fill('email', 'student@a.edu')
    fill('institution', 'test institution')
    fill('roster id', 'R-0001')
    fill('password', 'Passw0rd1')
    fill('confirm password', 'Passw0rd1')
    fireEvent.click(screen.getByText('Create account'))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('consent is required')
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('password mismatch shows an error and never calls the api', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('Register'))
    fill('password', 'Passw0rd1')
    fill('confirm password', 'Different1')
    fireEvent.click(screen.getByText('Create account'))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('passwords do not match')
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('server login errors appear in the aria-live message slot', async () => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'invalid email or password' }, 401))
    render(<App />)
    fill('email', 'ghost@a.edu')
    fill('password', 'WrongPass1')
    fireEvent.click(screen.getByText('Sign in'))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('invalid email or password')
    })
  })

  it('successful login redirects to the role default route from the server response', async () => {
    fetch.mockResolvedValue(jsonResponse({ role: 'student' }))
    render(<App />)
    fill('email', 'student@a.edu')
    fill('password', 'Passw0rd1')
    fireEvent.click(screen.getByText('Sign in'))
    await waitFor(() => {
      expect(screen.getByText('consent')).toBeTruthy() // Student screen's consent panel
    })
    // the student screen now loads consent + exams on mount; find the login call
    const loginCall = fetch.mock.calls.find(([url]) => url.includes('/auth/login'))
    expect(loginCall).toBeTruthy()
    const [url, init] = loginCall
    expect(init.credentials).toBe('include')
  })

  it('the submit button is disabled while a request is in flight', async () => {
    let resolveFetch
    fetch.mockImplementation(() => new Promise((r) => { resolveFetch = r }))
    render(<App />)
    fill('email', 'student@a.edu')
    fill('password', 'Passw0rd1')
    fireEvent.click(screen.getByText('Sign in'))
    await waitFor(() => {
      expect(screen.getByText('signing in…')).toBeTruthy()
    })
    resolveFetch(jsonResponse({ role: 'student' }))
    await waitFor(() => {
      expect(screen.getByText('consent')).toBeTruthy()
    })
  })
})
