import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'
import type { CookieOptions, Request, Response } from 'express'

import { EnvKeys } from 'src/env'

const SESSION_COOKIE_NAME = 'theater_session'
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env(EnvKeys.NODE_ENV, 'development') === 'production',
  signed: true,
  maxAge: SESSION_MAX_AGE_MS,
})

@Injectable()
export class AuthService {
  // timingSafeEqual requires equal-length buffers and throws otherwise, which
  // would leak the real password's length through a thrown-vs-compared
  // timing difference. Hashing both sides first gives fixed-length digests
  // regardless of input length, so the comparison itself stays constant-time.
  verifyPassword(candidate: string): boolean {
    const expected = env(EnvKeys.THEATER_PASSWORD)
    const expectedDigest = createHash('sha256').update(expected).digest()
    const candidateDigest = createHash('sha256').update(candidate).digest()

    return timingSafeEqual(expectedDigest, candidateDigest)
  }

  issueSession(res: Response, username: string): void {
    res.cookie(SESSION_COOKIE_NAME, username, sessionCookieOptions())
  }

  readSession(req: Request): string | null {
    // cookie-parser sets this to `false` when the signature check fails, and
    // leaves it `undefined` when the cookie is absent — both mean "no valid
    // session" here.
    const value = req.signedCookies[SESSION_COOKIE_NAME]
    return typeof value === 'string' ? value : null
  }

  clearSession(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions())
  }
}
