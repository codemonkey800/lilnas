'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { FormEvent, useState } from 'react'

import { register } from './actions'

export function RegisterForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword
  const passwordTooShort = password.length > 0 && password.length < 8
  const canSubmit =
    email.length > 0 &&
    password.length >= 8 &&
    password === confirmPassword &&
    !loading

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData()
    formData.set('email', email)
    formData.set('password', password)

    const result = await register(formData)

    setLoading(false)

    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error)
    }
  }

  if (success) {
    return (
      <div
        className={cns(
          'flex w-full max-w-sm flex-col items-center gap-6',
          'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
          'animate-slide-up',
        )}
      >
        {/* Checkmark icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-overlay">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 text-success"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold text-text">Account created!</h1>
          <p className="text-sm text-text-secondary">
            You can now sign in with your credentials.
          </p>
        </div>

        <Link
          href="/login"
          className={cns(
            'inline-flex w-full items-center justify-center rounded-sm px-4 py-2',
            'bg-primary text-sm font-medium text-text-inverse',
            'transition-colors duration-150 ease-smooth',
            'hover:bg-primary-600',
            'focus-visible:shadow-focus',
          )}
        >
          Continue to sign in
        </Link>
      </div>
    )
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
          Create your account
        </h1>
        <p className="text-sm text-text-secondary">
          Sign up to get started with Sync.
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
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={cns(
              'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
              'text-sm text-text placeholder:text-text-muted',
              'transition-colors duration-150 ease-smooth',
              'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            )}
          />
          {passwordTooShort && (
            <p className="text-sm text-error animate-fade-in">
              Password must be at least 8 characters.
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-secondary">
            Confirm password
          </span>
          <input
            type="password"
            name="confirmPassword"
            required
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className={cns(
              'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
              'text-sm text-text placeholder:text-text-muted',
              'transition-colors duration-150 ease-smooth',
              'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            )}
          />
          {passwordMismatch && (
            <p className="text-sm text-error animate-fade-in">
              Passwords do not match.
            </p>
          )}
        </label>

        {error && <p className="text-sm text-error animate-fade-in">{error}</p>}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className={cns(
          'inline-flex items-center justify-center rounded-sm px-4 py-2',
          'bg-primary text-sm font-medium text-text-inverse',
          'transition-colors duration-150 ease-smooth',
          'hover:bg-primary-600',
          'focus-visible:shadow-focus',
          'disabled:opacity-40',
        )}
      >
        {loading ? 'Creating account...' : 'Create account'}
      </button>

      <p className="text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link
          href="/login"
          className={cns(
            'font-medium text-primary-300',
            'transition-colors duration-150 ease-smooth',
            'hover:text-primary-200',
          )}
        >
          Sign in
        </Link>
      </p>
    </form>
  )
}
