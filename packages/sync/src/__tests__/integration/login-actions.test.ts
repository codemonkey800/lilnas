import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock next-auth to avoid pulling in next/server in the test environment.
// The action imports AuthError from next-auth for instanceof checks, so both
// the action and the test must share the same mock class.
vi.mock('next-auth', () => {
  class AuthError extends Error {
    static type = 'AuthError'
  }
  class CredentialsSignin extends AuthError {
    static type = 'CredentialsSignin'
  }
  return { AuthError, CredentialsSignin }
})

// Mock src/auth with signIn before importing the action
vi.mock('src/auth', () => ({
  signIn: vi.fn(),
}))

const authModule = await import('src/auth')
const mockSignIn = authModule.signIn as unknown as Mock

const { loginWithCredentials } = await import('src/app/(auth)/login/actions')
const { CredentialsSignin } = await import('next-auth')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value)
  }
  return fd
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('loginWithCredentials', () => {
  beforeEach(() => {
    mockSignIn.mockReset()
  })

  it('returns success when signIn succeeds', async () => {
    mockSignIn.mockResolvedValueOnce(undefined)

    const result = await loginWithCredentials(
      formData({ email: 'alice@test.com', password: 'securepass123' }),
    )

    expect(result).toEqual({ success: true })
    expect(mockSignIn).toHaveBeenCalledWith('credentials', {
      email: 'alice@test.com',
      password: 'securepass123',
      redirect: false,
    })
  })

  it('rejects missing email', async () => {
    const result = await loginWithCredentials(
      formData({ password: 'securepass123' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Please enter a valid email address.',
    })
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('rejects empty email', async () => {
    const result = await loginWithCredentials(
      formData({ email: '', password: 'securepass123' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Please enter a valid email address.',
    })
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('rejects missing password', async () => {
    const result = await loginWithCredentials(
      formData({ email: 'alice@test.com' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Please enter your password.',
    })
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('rejects empty password', async () => {
    const result = await loginWithCredentials(
      formData({ email: 'alice@test.com', password: '' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Please enter your password.',
    })
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns error for AuthError (invalid credentials)', async () => {
    mockSignIn.mockRejectedValueOnce(new CredentialsSignin())

    const result = await loginWithCredentials(
      formData({ email: 'alice@test.com', password: 'wrongpass123' }),
    )

    expect(result).toEqual({
      success: false,
      error: 'Invalid email or password.',
    })
  })

  it('re-throws non-AuthError exceptions', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('network failure'))

    await expect(
      loginWithCredentials(
        formData({ email: 'alice@test.com', password: 'securepass123' }),
      ),
    ).rejects.toThrow('network failure')
  })
})
