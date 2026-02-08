'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { loginWithCredentials } from './actions'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData()
    formData.set('email', email)
    formData.set('password', password)

    const result = await loginWithCredentials(formData)

    setLoading(false)

    if (result.success) {
      router.push('/')
    } else {
      setError(result.error)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cns(
        'flex w-full max-w-sm flex-col gap-6',
        'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
        'animate-fade-in',
      )}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-text md:text-3xl">
          Sign in to Sync
        </h1>
        <p className="text-sm text-text-secondary">
          Enter your credentials to continue.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-secondary">
            Email address
          </span>
          <input
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={cns(
              'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
              'text-sm text-text placeholder:text-text-muted',
              'transition-colors duration-150 ease-smooth',
              'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            )}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-secondary">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={cns(
              'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
              'text-sm text-text placeholder:text-text-muted',
              'transition-colors duration-150 ease-smooth',
              'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            )}
          />
        </label>

        {error && <p className="text-sm text-error animate-fade-in">{error}</p>}
      </div>

      <button
        type="submit"
        disabled={loading}
        className={cns(
          'inline-flex items-center justify-center rounded-sm px-4 py-2',
          'bg-primary text-sm font-medium text-text-inverse',
          'transition-colors duration-150 ease-smooth',
          'hover:bg-primary-600',
          'focus-visible:shadow-focus',
          'disabled:opacity-40',
        )}
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>

      <p className="text-center text-sm text-text-secondary">
        Don&apos;t have an account?{' '}
        <Link
          href="/register"
          className={cns(
            'font-medium text-primary-300',
            'transition-colors duration-150 ease-smooth',
            'hover:text-primary-200',
          )}
        >
          Create one
        </Link>
      </p>
    </form>
  )
}
