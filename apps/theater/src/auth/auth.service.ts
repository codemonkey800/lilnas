import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'
import { parse } from 'cookie'
import cookieParser from 'cookie-parser'
import type { CookieOptions, Request, Response } from 'express'

import { EnvKeys } from 'src/env'

const SESSION_COOKIE_NAME = 'theater_session'
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// cookie-parser signs a cookie value as `s:<value>.<hmac>`; anything without
// this prefix was never signed by this app.
const SIGNED_COOKIE_PREFIX = 's:'

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

  // The Socket.IO handshake only exposes the raw `Cookie:` header string
  // (`client.handshake.headers.cookie`), not an Express `Request` with
  // `signedCookies` already populated by the cookie-parser middleware. This
  // parses + unsigns that raw header directly so the gateway can authenticate
  // without one, and `readSession` below delegates here so both paths share
  // one verification path.
  verifySessionCookie(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) {
      return null
    }

    const raw = parse(cookieHeader)[SESSION_COOKIE_NAME]

    // cookie-parser's `signedCookie()` treats a value that does NOT start
    // with the `s:` signing prefix as an already-unsigned passthrough value
    // and returns it *unchanged* — it only returns `false` when a
    // `s:`-prefixed value's signature fails verification. This app always
    // issues the cookie signed (`signed: true` above), so a legitimate
    // cookie always starts with `s:`; a value missing that prefix means the
    // signature was stripped entirely and must be rejected here, before it
    // ever reaches `signedCookie()` — otherwise a stripped cookie would pass
    // through as if it were verified.
    if (typeof raw !== 'string' || !raw.startsWith(SIGNED_COOKIE_PREFIX)) {
      return null
    }

    const secret = env(EnvKeys.THEATER_SESSION_SECRET)
    // `cookie-parser` exposes `signedCookie` as a static on its default
    // export (matching bootstrap.ts's `import cookieParser from
    // 'cookie-parser'`), not as a real named export — the false positive
    // eslint-plugin-import flags here.
    // eslint-disable-next-line import/no-named-as-default-member
    const value = cookieParser.signedCookie(raw, secret)

    return typeof value === 'string' ? value : null
  }

  readSession(req: Request): string | null {
    return this.verifySessionCookie(req.headers.cookie)
  }

  clearSession(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions())
  }
}
