import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock src/auth with signOut before importing the action
vi.mock('src/auth', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}))

const authModule = await import('src/auth')
const mockSignOut = authModule.signOut as unknown as Mock

const { signOutAction } = await import('src/auth/sign-out-action')

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('signOutAction', () => {
  beforeEach(() => {
    mockSignOut.mockClear()
  })

  it('calls signOut with redirect to /login', async () => {
    await signOutAction()

    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/login' })
  })

  it('propagates errors from signOut', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('signOut failed'))

    await expect(signOutAction()).rejects.toThrow('signOut failed')
  })
})
