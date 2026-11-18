import type { Request, Response } from 'express'
import type { PinoLogger } from 'nestjs-pino'

import type { GatedHostsService } from 'src/services/gated-hosts.service'
import type { HostActivityService } from 'src/services/host-activity.service'
import * as stripModule from 'src/verify/strip-auth-cookies'
import {
  VERIFY_RESPONSE_HEADERS,
  VERIFY_SANITIZED_HEADERS,
  VerifyController,
} from 'src/verify/verify.controller'
import type { VerifyService } from 'src/verify/verify.service'

// Failure-path and constant coverage for the ALLOW branch's Cookie handling.
// The real-HTTP behaviour (headers on the wire) is covered by the
// "VerifyController integration" block in verify.service.spec.ts.

jest.mock('src/verify/strip-auth-cookies', () => {
  const actual = jest.requireActual<
    typeof import('src/verify/strip-auth-cookies')
  >('src/verify/strip-auth-cookies')
  return { ...actual, stripAuthCookies: jest.fn(actual.stripAuthCookies) }
})

const SECRET = 'super-secret-cookie-value'

type Decision = Awaited<ReturnType<VerifyService['decide']>>

function makeController(decision: Decision) {
  const verifyService = {
    decide: jest.fn().mockResolvedValue(decision),
  } as unknown as VerifyService
  const gatedHosts = { recordSeen: jest.fn() } as unknown as GatedHostsService
  const hostActivity = {
    recordVisit: jest.fn(),
  } as unknown as HostActivityService
  const logger = { warn: jest.fn() }
  const controller = new VerifyController(
    verifyService,
    gatedHosts,
    hostActivity,
    logger as unknown as PinoLogger,
  )
  return { controller, logger }
}

function makeRes() {
  return {
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  }
}

function makeReq(cookie: string | undefined): Request {
  return {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      'x-forwarded-host': 'svc.lilnas.io',
      'x-forwarded-proto': 'https',
      'x-forwarded-uri': '/',
    },
  } as unknown as Request
}

function headerNames(res: ReturnType<typeof makeRes>): string[] {
  return res.setHeader.mock.calls.map(([name]) => String(name))
}

const ALLOW: Decision = {
  outcome: 'allow',
  email: 'u@example.com',
  userId: 'user-1',
}

const strip = jest.mocked(stripModule.stripAuthCookies)
const realStrip = jest.requireActual<typeof stripModule>(
  'src/verify/strip-auth-cookies',
).stripAuthCookies

beforeEach(() => {
  strip.mockReset()
  strip.mockImplementation(realStrip)
})

describe('VERIFY_SANITIZED_HEADERS', () => {
  it('is exactly Cookie and does not overlap the identity headers', () => {
    expect(VERIFY_SANITIZED_HEADERS).toEqual(['Cookie'])
    for (const header of VERIFY_SANITIZED_HEADERS) {
      expect(VERIFY_RESPONSE_HEADERS as readonly string[]).not.toContain(header)
    }
  })
})

describe('VerifyController ALLOW Cookie handling', () => {
  it('sets Cookie to the request cookies minus the lilnas-auth ones', async () => {
    const { controller } = makeController(ALLOW)
    const res = makeRes()

    await controller.verify(
      makeReq('a=1; lilnas-auth.session_token=tok; b=2'),
      res as unknown as Response,
    )

    expect(res.setHeader).toHaveBeenCalledWith('Cookie', 'a=1; b=2')
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Forwarded-User',
      'u@example.com',
    )
    expect(res.setHeader).toHaveBeenCalledWith('X-Forwarded-User-Id', 'user-1')
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('sets no Cookie header when only lilnas-auth cookies were sent, or none at all', async () => {
    for (const cookie of ['lilnas-auth.session_token=tok', undefined]) {
      const { controller } = makeController(ALLOW)
      const res = makeRes()

      await controller.verify(makeReq(cookie), res as unknown as Response)

      expect(headerNames(res)).not.toContain('Cookie')
      expect(res.status).toHaveBeenCalledWith(200)
    }
  })

  it('sends no Cookie header, logs a warning without cookie content, and still answers 200 when sanitizing throws', async () => {
    strip.mockImplementation(() => {
      throw new Error(`boom ${SECRET}`)
    })
    const { controller, logger } = makeController(ALLOW)
    const res = makeRes()

    await controller.verify(makeReq(`a=${SECRET}`), res as unknown as Response)

    expect(headerNames(res)).not.toContain('Cookie')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.end).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET)
  })

  it('sends no Cookie header, logs a warning without cookie content, and still answers 200 when setHeader("Cookie") throws', async () => {
    const { controller, logger } = makeController(ALLOW)
    const res = makeRes()
    res.setHeader.mockImplementation((name: string) => {
      if (name === 'Cookie') throw new TypeError(`Invalid character ${SECRET}`)
      return res
    })

    await controller.verify(makeReq(`a=${SECRET}`), res as unknown as Response)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.end).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET)
    // The identity headers were set before the failure and stay set.
    expect(res.setHeader).toHaveBeenCalledWith('X-Forwarded-User-Id', 'user-1')
  })

  it('does not touch Cookie on a redirect or a fail-closed 500', async () => {
    const redirect = makeController({
      outcome: 'redirect',
      location: 'https://login.lilnas.io/login',
    })
    const redirectRes = makeRes()
    await redirect.controller.verify(
      makeReq('a=1'),
      redirectRes as unknown as Response,
    )
    expect(headerNames(redirectRes)).toEqual(['Location'])

    const failClosed = makeController({
      outcome: 'fail-closed',
      reason: 'missing host',
    })
    const failRes = makeRes()
    await failClosed.controller.verify(
      makeReq('a=1'),
      failRes as unknown as Response,
    )
    expect(failRes.setHeader).not.toHaveBeenCalled()
    expect(failRes.status).toHaveBeenCalledWith(500)
  })
})
