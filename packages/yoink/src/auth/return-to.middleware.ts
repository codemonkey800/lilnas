import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

import { OAUTH_RETURN_TO_COOKIE } from './constants'

/**
 * Captures the `return_to` query param and stores it in a short-lived cookie
 * so it survives the Google OAuth redirect round-trip.
 *
 * Must run before the AuthGuard('google') since Passport sends the 302 to
 * Google before the controller body executes.
 */
@Injectable()
export class ReturnToMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const returnTo = req.query.return_to as string | undefined
    const safe =
      typeof returnTo === 'string' && returnTo.startsWith('/')
        ? returnTo
        : undefined

    if (safe && safe !== '/') {
      res.cookie(OAUTH_RETURN_TO_COOKIE, safe, {
        maxAge: 5 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
      })
    }

    next()
  }
}
