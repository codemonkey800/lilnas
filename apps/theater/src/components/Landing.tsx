'use client'

import { cns } from '@lilnas/utils/cns'
import { FormEvent, useMemo, useState } from 'react'

import { USERNAME_MAX_LENGTH, UsernameSchema } from 'src/auth/username.schema'

import { useSession } from './SessionContext'

export function Landing() {
  const { login } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usernameError = useMemo(() => {
    if (username.length === 0) return null
    const result = UsernameSchema.safeParse(username)
    return result.success ? null : (result.error.issues[0]?.message ?? null)
  }, [username])

  const canSubmit =
    !submitting &&
    password.length > 0 &&
    UsernameSchema.safeParse(username).success

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)

    const result = await login(username, password)
    if (!result.ok) {
      setError(result.error)
    }
    setSubmitting(false)
  }

  return (
    <div className="flex flex-auto items-center justify-center p-8">
      <form
        onSubmit={event => void handleSubmit(event)}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-8"
      >
        <h1 className="text-center text-2xl font-medium">Lilnas Theater</h1>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-white/70">Username</span>
          <input
            name="username"
            className="rounded border border-white/20 bg-black/40 px-3 py-2 outline-none focus:border-white/50"
            value={username}
            onChange={event => setUsername(event.target.value)}
            autoComplete="username"
            maxLength={USERNAME_MAX_LENGTH}
            autoFocus
          />
          {usernameError && (
            <span className="text-sm text-red-400">{usernameError}</span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-white/70">Password</span>
          <input
            type="password"
            name="password"
            className="rounded border border-white/20 bg-black/40 px-3 py-2 outline-none focus:border-white/50"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cns(
            'rounded bg-white px-4 py-2 font-medium text-black transition',
            !canSubmit && 'cursor-not-allowed opacity-50',
          )}
        >
          {submitting ? 'Signing in…' : 'Enter'}
        </button>
      </form>
    </div>
  )
}
