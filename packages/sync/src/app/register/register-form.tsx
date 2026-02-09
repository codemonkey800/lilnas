'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { FormEvent, useState } from 'react'
import {
  HiArrowRight,
  HiCheckCircle,
  HiExclamationCircle,
  HiUserPlus,
} from 'react-icons/hi2'

import { Button } from 'src/components/ui/button'
import { Card } from 'src/components/ui/card'
import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'

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
      <Card className="max-w-sm items-center animate-slide-up">
        {/* Checkmark icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-overlay">
          <HiCheckCircle className="h-8 w-8 text-success" />
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
          <HiArrowRight className="h-4 w-4" />
        </Link>
      </Card>
    )
  }

  return (
    <Card className="max-w-sm">
      <form onSubmit={handleSubmit} className="contents">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-text md:text-3xl">
            Create your account
          </h1>
          <p className="text-sm text-text-secondary">
            Sign up to get started with Sync.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <FormField label="Email address">
            <Input
              type="email"
              name="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </FormField>

          <FormField
            label="Password"
            error={
              passwordTooShort
                ? 'Password must be at least 8 characters.'
                : null
            }
          >
            <Input
              type="password"
              name="password"
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </FormField>

          <FormField
            label="Confirm password"
            error={passwordMismatch ? 'Passwords do not match.' : null}
          >
            <Input
              type="password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </FormField>

          {error && (
            <p className="flex items-center gap-1.5 text-sm text-error animate-fade-in">
              <HiExclamationCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <Button type="submit" disabled={!canSubmit} loading={loading}>
          {!loading && <HiUserPlus className="h-4 w-4" />}
          {loading ? 'Creating account...' : 'Create account'}
        </Button>

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
            <HiArrowRight className="inline h-3.5 w-3.5" />
          </Link>
        </p>
      </form>
    </Card>
  )
}
