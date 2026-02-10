import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from 'src/lib/password'

describe('hashPassword', () => {
  it('returns a bcrypt hash that differs from the plaintext', async () => {
    const hash = await hashPassword('my-secret')
    expect(hash).not.toBe('my-secret')
    expect(hash).toMatch(/^\$2[aby]?\$/)
  })

  it('produces different hashes for the same input (unique salts)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ])
    expect(a).not.toBe(b)
  })
})

describe('verifyPassword', () => {
  it('returns true for a matching password', async () => {
    const hash = await hashPassword('correct-horse')
    await expect(verifyPassword('correct-horse', hash)).resolves.toBe(true)
  })

  it('returns false for a non-matching password', async () => {
    const hash = await hashPassword('correct-horse')
    await expect(verifyPassword('wrong-horse', hash)).resolves.toBe(false)
  })

  it('returns false for an empty password against a valid hash', async () => {
    const hash = await hashPassword('some-password')
    await expect(verifyPassword('', hash)).resolves.toBe(false)
  })
})
