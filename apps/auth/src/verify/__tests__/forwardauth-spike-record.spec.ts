/**
 * Durable record of U1's empirical spike (see
 * docs/plans/2026-07-31-001-feat-lilnas-auth-forward-auth-spike-findings.md). Traefik's ForwardAuth and SSE
 * behavior was proven live against a throwaway stub and a dev Traefik instance; that infrastructure was torn
 * down afterward. This file locks in the proven contract as fixtures so a future contributor (or a Traefik
 * version bump) can't silently drift from what was actually observed. It does not exercise a live Traefik or
 * the real /verify controller — those are apps/auth/src/verify/__tests__/verify.service.spec.ts (U5).
 *
 * RECORDED, NOT ASSERTED: every case below compares hardcoded literals to hardcoded literals — this file has
 * zero imports and exercises no production code, so none of them can ever fail. They are a durable, dated
 * record of what U1's spike actually observed, not regression coverage; the `describe()` names below say so
 * explicitly, on purpose, so a reader auditing what's actually guarded doesn't mistake nine green checks here
 * for nine live guarantees. The two claims that ARE independently backed by real production code are asserted
 * for real elsewhere: Location-header absoluteness in verify.service.spec.ts's own "a signed-out visitor is
 * redirected..." test, and /verify never setting Set-Cookie in that same file's "VerifyController integration"
 * block (added specifically so this file no longer needs to make that claim itself — see this file's history
 * for the tautological version this replaced).
 */

describe('RECORDED (not asserted): ForwardAuth contract (proven in U1 spike)', () => {
  it('forwards the Cookie header on the subrequest unmodified', () => {
    const sentCookie = 'session=abc123; other=xyz'
    const observedByAuthServer = 'session=abc123; other=xyz'

    expect(observedByAuthServer).toBe(sentCookie)
  })

  it('synthesizes X-Forwarded-* headers that reconstruct the original request byte-for-byte', () => {
    const originalRequest = {
      host: 'stub-allow.localhost',
      pathAndQuery: '/some/path?query=1',
      proto: 'http',
    }
    const observedHeaders = {
      'x-forwarded-host': 'stub-allow.localhost',
      'x-forwarded-proto': 'http',
      'x-forwarded-uri': '/some/path?query=1',
      'x-forwarded-method': 'GET',
    }

    expect(observedHeaders['x-forwarded-host']).toBe(originalRequest.host)
    expect(observedHeaders['x-forwarded-proto']).toBe(originalRequest.proto)
    expect(observedHeaders['x-forwarded-uri']).toBe(
      originalRequest.pathAndQuery,
    )

    const reconstructed = `${observedHeaders['x-forwarded-proto']}://${observedHeaders['x-forwarded-host']}${observedHeaders['x-forwarded-uri']}`
    expect(reconstructed).toBe(
      `${originalRequest.proto}://${originalRequest.host}${originalRequest.pathAndQuery}`,
    )
  })

  describe('Location header handling (the central risk this design guards against)', () => {
    it('rewrites a relative Location to a container-internal, browser-unreachable URL when preserveLocationHeader is unset', () => {
      const authServerSent = '/relative-target'
      const clientReceived = 'http://verify-stub:9999/relative-target'

      expect(clientReceived).not.toBe(authServerSent)
      expect(clientReceived.startsWith('http://verify-stub')).toBe(true)
    })

    it('passes a relative Location through unmodified when preserveLocationHeader=true, but it still resolves against the wrong origin', () => {
      const authServerSent = '/relative-target'
      const clientReceived = '/relative-target'

      expect(clientReceived).toBe(authServerSent)

      const requestOrigin = 'https://stub-redirect-rel-preserve.localhost'
      const authHostOrigin = 'https://login.lilnas.io'
      const browserResolvesAgainst = requestOrigin

      expect(browserResolvesAgainst).not.toBe(authHostOrigin)
    })

    it('passes an absolute https:// Location through unmodified regardless of preserveLocationHeader', () => {
      const authServerSent = 'https://stub.localhost/absolute-target'
      const clientReceived = 'https://stub.localhost/absolute-target'

      expect(clientReceived).toBe(authServerSent)
    })
  })

  it('relays a non-2xx response with status and body intact', () => {
    const stubResponse = { status: 418, body: "I'm a teapot" }
    const clientReceived = { status: 418, body: "I'm a teapot" }

    expect(clientReceived).toEqual(stubResponse)
  })
})

describe('RECORDED (not asserted): SSE through Traefik (proven in U1 spike)', () => {
  it('streams events at the source interval rather than buffering until connection close', () => {
    const tickTimestampsMs = [0, 3000, 6000, 9000, 12000]
    const gaps: number[] = []
    let previousTick: number | undefined
    for (const tick of tickTimestampsMs) {
      if (previousTick !== undefined) gaps.push(tick - previousTick)
      previousTick = tick
    }

    for (const gap of gaps) {
      expect(gap).toBeLessThan(5000)
      expect(gap).toBeGreaterThan(1000)
    }
  })

  it('survives past a single keepalive interval without being dropped', () => {
    const connectionDurationMs = 13000
    const singleKeepaliveIntervalMs = 3000

    expect(connectionDurationMs).toBeGreaterThan(singleKeepaliveIntervalMs)
  })
})
