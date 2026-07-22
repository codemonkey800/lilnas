'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

type LoginResult = { ok: true } | { ok: false; error: string }

type SessionContextValue = {
  status: SessionStatus
  username: string | null
  login: (username: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (
      body &&
      typeof body === 'object' &&
      'errors' in body &&
      Array.isArray(body.errors) &&
      body.errors.length > 0
    ) {
      return body.errors.join(', ')
    }
  } catch {
    // Response body wasn't JSON — fall through to the generic message below.
  }

  return res.status === 401 ? 'Incorrect password' : 'Login failed'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/auth/session')
      .then(async res => {
        if (cancelled) return
        if (res.ok) {
          const body: { username: string } = await res.json()
          setUsername(body.username)
          setStatus('authenticated')
        } else {
          setStatus('unauthenticated')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(
    async (usernameInput: string, password: string): Promise<LoginResult> => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password }),
      })

      if (!res.ok) {
        return { ok: false, error: await readErrorMessage(res) }
      }

      const body: { username: string } = await res.json()
      setUsername(body.username)
      setStatus('authenticated')
      return { ok: true }
    },
    [],
  )

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUsername(null)
    setStatus('unauthenticated')
  }, [])

  return (
    <SessionContext.Provider value={{ status, username, login, logout }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return ctx
}
