import type { Request } from 'express'

import { RequestsController } from 'src/requests/requests.controller'
import type { RequestsService } from 'src/requests/requests.service'
import type {
  ServiceRegistryEntry,
  ServiceRegistryService,
} from 'src/services/service-registry.service'
import type { AccessCacheService } from 'src/verify/access-cache.service'

// ──────────────────────────────────────────────────────────────────────────────
// #13 (from REVIEW.md): no spec previously imported or constructed
// RequestsController at all, despite it independently re-implementing
// VerifyService.decide()'s own AE6 ordering (isBlocked BEFORE hasGrant) and
// owning the R7 structural-silence contract. Unit-tests it directly — fake
// AccessCacheService/RequestsService/ServiceRegistryService, same style as
// sse.controller.spec.ts's fakeAccessCache and
// src/admin/__tests__/user-management.spec.ts's fakeServiceRegistry —
// covering:
//   - AE6 ordering: a blocked user with an existing grant must never see
//     'granted', and must never have a request row created for it either.
//   - parseServiceHost()'s two throw branches (missing / malformed
//     redirect).
//   - #6's registry check: an unknown (off-registry) host reports the SAME
//     indistinguishable pending shape (R7) rather than a 400, and never
//     creates a request row.
//
// Revised for rejection visibility (see requests.service.ts's own header
// comment): status()'s 'pending'/'rejected' outcomes are now a straight
// pass-through of whatever fakeRequestsService.requestAccess() returns,
// rather than a reconstructed `{ outcome: 'pending', canReRequest }` shape
// — the "creates a request..." test below deliberately uses a 'rejected'
// override (not the 'pending' default) to prove the pass-through actually
// forwards the service's exact result instead of hardcoding one outcome.
// reRequest()'s own response collapsed to a uniform `{ ok: true }` — see
// that method's own comment for why there is nothing left to branch on.
//
// Revised AGAIN for the blocked-opacity reversal (see requests.controller.ts's
// own header comment): the AE6 test below now expects `{ outcome: 'blocked' }`,
// not the old opaque `{ outcome: 'pending' }` — the ORDERING this test
// covers (isBlocked checked before hasGrant, no request row created) is
// unchanged; only the reported outcome shape for that branch changed.
// ──────────────────────────────────────────────────────────────────────────────

function fakeAccessCache(
  session: { userId: string; email: string } | null,
  opts: { blocked?: boolean; hasGrant?: boolean } = {},
): AccessCacheService {
  return {
    resolveSession: jest.fn().mockResolvedValue(session),
    isBlocked: jest.fn().mockReturnValue(opts.blocked ?? false),
    hasGrant: jest.fn().mockReturnValue(opts.hasGrant ?? false),
  } as unknown as AccessCacheService
}

function fakeRequestsService(
  overrides: {
    requestAccess?: { outcome: 'pending' } | { outcome: 'rejected' }
  } = {},
): RequestsService {
  return {
    requestAccess: jest
      .fn()
      .mockReturnValue(overrides.requestAccess ?? { outcome: 'pending' }),
    reRequestAccess: jest.fn(),
  } as unknown as RequestsService
}

function fakeServiceRegistry(
  entries: ServiceRegistryEntry[],
): ServiceRegistryService {
  return {
    getServices: jest.fn().mockResolvedValue(entries),
  } as unknown as ServiceRegistryService
}

function fakeRequest(cookie?: string): Request {
  return { headers: { cookie } } as unknown as Request
}

const KNOWN_HOST = 'swole.lilnas.io'
const REDIRECT_URL = `https://${KNOWN_HOST}/dashboard`
const KNOWN_REGISTRY = [{ host: KNOWN_HOST, gatedBy: 'lilnas-auth' as const }]

describe('RequestsController', () => {
  describe('GET /requests/status', () => {
    it('reports pending with no session, and never calls requestsService', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache(null),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.status(
        fakeRequest(undefined),
        REDIRECT_URL,
      )

      expect(result).toEqual({ outcome: 'pending' })
      expect(requestsService.requestAccess).not.toHaveBeenCalled()
    })

    it('covers AE6: a blocked user with an existing grant for the host is never reported as granted, and no request row is created', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache(
          { userId: 'user_1', email: 'blocked@example.com' },
          { blocked: true, hasGrant: true },
        ),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.status(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      // Reversed post-launch (see this file's own header comment): a
      // blocked user's own dedicated outcome, not the opaque 'pending'
      // shape this branch used to report.
      expect(result).toEqual({ outcome: 'blocked' })
      expect(requestsService.requestAccess).not.toHaveBeenCalled()
    })

    it('reports granted when the (non-blocked) user already has a grant for the host', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache(
          { userId: 'user_1', email: 'granted@example.com' },
          { hasGrant: true },
        ),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.status(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      expect(result).toEqual({ outcome: 'granted' })
      expect(requestsService.requestAccess).not.toHaveBeenCalled()
    })

    it('covers #6: an unknown (off-registry) host reports the same pending shape and never creates a request row', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache({ userId: 'user_1', email: 'someone@example.com' }),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.status(
        fakeRequest('cookie=x'),
        'https://unknown-host.lilnas.io/dashboard',
      )

      expect(result).toEqual({ outcome: 'pending' })
      expect(requestsService.requestAccess).not.toHaveBeenCalled()
    })

    it('an already-granted host still works even if the host is not (or is no longer) in the registry', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache(
          { userId: 'user_1', email: 'granted@example.com' },
          { hasGrant: true },
        ),
        // Empty registry — proves the grant check runs BEFORE the registry
        // check, so a host that later drops out of the registry doesn't
        // stop working for someone already granted it.
        fakeServiceRegistry([]),
      )

      const result = await controller.status(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      expect(result).toEqual({ outcome: 'granted' })
    })

    it('creates a request for a known, ungranted host and returns the service result verbatim (pass-through, not reconstructed)', async () => {
      const requestsService = fakeRequestsService({
        requestAccess: { outcome: 'rejected' },
      })
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache({ userId: 'user_1', email: 'someone@example.com' }),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.status(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      expect(result).toEqual({ outcome: 'rejected' })
      expect(requestsService.requestAccess).toHaveBeenCalledWith(
        'user_1',
        KNOWN_HOST,
      )
    })

    it('parseServiceHost: throws on a missing redirect param', async () => {
      const controller = new RequestsController(
        fakeRequestsService(),
        fakeAccessCache(null),
        fakeServiceRegistry([]),
      )

      await expect(
        controller.status(fakeRequest(undefined), undefined),
      ).rejects.toThrow(/missing redirect/)
    })

    it('parseServiceHost: throws on a malformed (unparseable) redirect param', async () => {
      const controller = new RequestsController(
        fakeRequestsService(),
        fakeAccessCache(null),
        fakeServiceRegistry([]),
      )

      await expect(
        controller.status(fakeRequest(undefined), 'not-a-url'),
      ).rejects.toThrow(/malformed redirect/)
    })
  })

  describe('POST /requests/re-request', () => {
    it('covers AE6: a blocked user reports {ok: true} and reRequestAccess is never called', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache(
          { userId: 'user_1', email: 'blocked@example.com' },
          { blocked: true, hasGrant: true },
        ),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.reRequest(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      expect(result).toEqual({ ok: true })
      expect(requestsService.reRequestAccess).not.toHaveBeenCalled()
    })

    it('covers #6: an unknown host reports {ok: true} and reRequestAccess is never called', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache({ userId: 'user_1', email: 'someone@example.com' }),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.reRequest(
        fakeRequest('cookie=x'),
        'https://unknown-host.lilnas.io/dashboard',
      )

      expect(result).toEqual({ ok: true })
      expect(requestsService.reRequestAccess).not.toHaveBeenCalled()
    })

    it('an already-granted host reports {ok: true} and reRequestAccess is never called', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache(
          { userId: 'user_1', email: 'granted@example.com' },
          { hasGrant: true },
        ),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.reRequest(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      expect(result).toEqual({ ok: true })
      expect(requestsService.reRequestAccess).not.toHaveBeenCalled()
    })

    it('calls reRequestAccess for a known, ungranted host and returns {ok: true}', async () => {
      const requestsService = fakeRequestsService()
      const controller = new RequestsController(
        requestsService,
        fakeAccessCache({ userId: 'user_1', email: 'someone@example.com' }),
        fakeServiceRegistry(KNOWN_REGISTRY),
      )

      const result = await controller.reRequest(
        fakeRequest('cookie=x'),
        REDIRECT_URL,
      )

      expect(result).toEqual({ ok: true })
      expect(requestsService.reRequestAccess).toHaveBeenCalledWith(
        'user_1',
        KNOWN_HOST,
      )
    })

    it('parseServiceHost: throws on a missing redirect param', async () => {
      const controller = new RequestsController(
        fakeRequestsService(),
        fakeAccessCache(null),
        fakeServiceRegistry([]),
      )

      await expect(
        controller.reRequest(fakeRequest(undefined), undefined),
      ).rejects.toThrow(/missing redirect/)
    })
  })
})
