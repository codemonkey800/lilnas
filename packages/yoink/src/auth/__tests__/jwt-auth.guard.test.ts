import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'
import { db } from 'src/db'

const ADMIN_EMAIL = 'admin@example.com'
const VALID_TOKEN = 'valid.jwt.token'

function makeContext(cookies: Record<string, string> = {}): {
  switchToHttp: () => {
    getRequest: () => Partial<Request> & { user?: unknown }
    getResponse: () => unknown
  }
} {
  const request: Partial<Request> & { user?: unknown } = { cookies }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  }
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  let mockJwt: jest.Mocked<JwtService>

  beforeEach(() => {
    mockJwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        email: 'test@example.com',
      }),
    } as unknown as jest.Mocked<JwtService>
    guard = new JwtAuthGuard(mockJwt)
    process.env.ADMIN_EMAIL = ADMIN_EMAIL
    ;(db.query.users.findFirst as jest.Mock).mockResolvedValue({
      status: 'approved',
      email: 'test@example.com',
    })
  })

  afterEach(() => {
    delete process.env.ADMIN_EMAIL
  })

  // ---------------------------------------------------------------------------
  // Missing token
  // ---------------------------------------------------------------------------

  it('throws UnauthorizedException when auth-token cookie is missing', async () => {
    await expect(guard.canActivate(makeContext({}) as never)).rejects.toThrow(
      UnauthorizedException,
    )
  })

  // ---------------------------------------------------------------------------
  // Invalid / expired token
  // ---------------------------------------------------------------------------

  it('throws UnauthorizedException when JWT verification fails', async () => {
    mockJwt.verifyAsync.mockRejectedValue(new Error('Token expired'))
    await expect(
      guard.canActivate(makeContext({ 'auth-token': VALID_TOKEN }) as never),
    ).rejects.toThrow(UnauthorizedException)
  })

  // ---------------------------------------------------------------------------
  // User not found in DB
  // ---------------------------------------------------------------------------

  it('throws ForbiddenException when user is not found in DB', async () => {
    ;(db.query.users.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(
      guard.canActivate(makeContext({ 'auth-token': VALID_TOKEN }) as never),
    ).rejects.toThrow(ForbiddenException)
  })

  // ---------------------------------------------------------------------------
  // Pending / denied user
  // ---------------------------------------------------------------------------

  it('throws ForbiddenException when user status is pending', async () => {
    ;(db.query.users.findFirst as jest.Mock).mockResolvedValue({
      status: 'pending',
      email: 'pending@example.com',
    })
    await expect(
      guard.canActivate(makeContext({ 'auth-token': VALID_TOKEN }) as never),
    ).rejects.toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when user status is denied', async () => {
    ;(db.query.users.findFirst as jest.Mock).mockResolvedValue({
      status: 'denied',
      email: 'denied@example.com',
    })
    await expect(
      guard.canActivate(makeContext({ 'auth-token': VALID_TOKEN }) as never),
    ).rejects.toThrow(ForbiddenException)
  })

  // ---------------------------------------------------------------------------
  // Approved user
  // ---------------------------------------------------------------------------

  it('returns true for an approved user', async () => {
    const result = await guard.canActivate(
      makeContext({ 'auth-token': VALID_TOKEN }) as never,
    )
    expect(result).toBe(true)
  })

  it('sets request.user with the JWT payload', async () => {
    const ctx = makeContext({ 'auth-token': VALID_TOKEN })
    await guard.canActivate(ctx as never)
    const request = ctx.switchToHttp().getRequest()
    expect(request.user).toEqual({ sub: 'user-1', email: 'test@example.com' })
  })

  // ---------------------------------------------------------------------------
  // Admin email bypass
  // ---------------------------------------------------------------------------

  it('allows access for admin email regardless of approval status', async () => {
    mockJwt.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      email: ADMIN_EMAIL,
    })
    ;(db.query.users.findFirst as jest.Mock).mockResolvedValue({
      status: 'denied',
      email: ADMIN_EMAIL,
    })
    const result = await guard.canActivate(
      makeContext({ 'auth-token': VALID_TOKEN }) as never,
    )
    expect(result).toBe(true)
  })

  it('denies access for non-admin email regardless of ADMIN_EMAIL env', async () => {
    ;(db.query.users.findFirst as jest.Mock).mockResolvedValue({
      status: 'pending',
      email: 'hacker@evil.com',
    })
    await expect(
      guard.canActivate(makeContext({ 'auth-token': VALID_TOKEN }) as never),
    ).rejects.toThrow(ForbiddenException)
  })
})
