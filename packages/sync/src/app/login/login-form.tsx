'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { Button } from 'src/components/ui/button'
import { Card } from 'src/components/ui/card'
import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'

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
    <Card className="max-w-sm">
      <form onSubmit={handleSubmit} className="contents">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-text md:text-3xl">
            Sign in to Sync
          </h1>
          <p className="text-sm text-text-secondary">
            Enter your credentials to continue.
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

          <FormField label="Password">
            <Input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </FormField>

          {error && (
            <p className="text-sm text-error animate-fade-in">{error}</p>
          )}
        </div>

        <Button type="submit" loading={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>

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
    </Card>
  )
}
