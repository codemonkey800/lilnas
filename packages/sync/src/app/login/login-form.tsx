'use client'

import { cns } from '@lilnas/utils/cns'
import { FormEvent, useState } from 'react'

import { sendMagicLink } from './actions'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData()
    formData.set('email', email)

    const result = await sendMagicLink(formData)

    setLoading(false)

    if (result.success) {
      setSubmitted(true)
    } else {
      setError(result.error)
    }
  }

  if (submitted) {
    return (
      <div
        className={cns(
          'flex w-full max-w-sm flex-col items-center gap-6',
          'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
          'animate-slide-up',
        )}
      >
        {/* Mail icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-overlay">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 text-primary-400"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold text-text">Check your email</h1>
          <p className="text-sm text-text-secondary">
            We sent a magic link to{' '}
            <span className="font-medium text-primary-300">{email}</span>
          </p>
          <p className="text-sm text-text-secondary">
            Click the link in the email to sign in. It may take a minute to
            arrive.
          </p>
        </div>

        <p className="text-xs text-text-muted">
          Don&apos;t see it? Check your spam folder.
        </p>

        <button
          type="button"
          onClick={() => {
            setSubmitted(false)
            setError(null)
          }}
          className={cns(
            'inline-flex items-center justify-center rounded-sm px-4 py-2',
            'text-sm font-medium text-text-secondary',
            'transition-colors duration-150 ease-smooth',
            'hover:bg-bg-overlay hover:text-text',
            'focus-visible:shadow-focus',
          )}
        >
          Use a different email
        </button>
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
          Sign in to Sync
        </h1>
        <p className="text-sm text-text-secondary">
          Enter your email and we&apos;ll send you a magic link.
        </p>
      </div>

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
        {error && <p className="text-sm text-error">{error}</p>}
      </label>

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
        {loading ? 'Sending...' : 'Continue with Email'}
      </button>
    </form>
  )
}
