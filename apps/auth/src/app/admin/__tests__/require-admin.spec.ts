import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  fetchAdminServices,
  requireAdminQueue,
} from 'src/app/admin/require-admin'

process.env.BACKEND_PORT = '8081'

// next/navigation's real redirect() never returns — it throws a special,
// Next-internal control-flow error to unwind the render and perform the
// actual navigation. Mocking it as a no-op jest.fn() would let
// requireAdminQueue()'s own code keep running past the call (falling
// through into the `!res.ok` branch below it and throwing a DIFFERENT,
// misleading error for a 401/403 response) — mimicking the throw is what
// makes this test assert the same "execution stops here" property real
// Next.js rendering has.
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

function mockIncomingCookie(cookie: string | undefined): void {
  ;(headers as jest.Mock).mockResolvedValue({
    get: (name: string) => (name === 'cookie' ? (cookie ?? null) : null),
  })
}

// ──────────────────────────────────────────────────────────────────────────────
// U7's own explicit test scenario: "an unauthenticated request to an admin
// route redirects to login rather than 403-ing." This is the one property
// AdminGuard's own unit tests (admin.guard.spec.ts) cannot cover — a Nest
// guard only ever throws an HTTP exception (401/403), it has no way to
// perform a browser-facing navigation. require-admin.ts's own job is
// turning that HTTP response into the redirect — this suite is what proves
// it actually does, for both the 401 (no session) and 403 (signed in, not
// an admin) cases, and that a genuinely successful response is passed
// through untouched.
// ──────────────────────────────────────────────────────────────────────────────
describe('requireAdminQueue', () => {
  // The module-level jest.mock('next/navigation', ...) factory above
  // creates ONE `redirect` jest.fn() shared by every test in this file —
  // explicitly cleared here rather than assumed clean, since this suite
  // asserts both "redirect WAS called" and "redirect was NOT called" across
  // different tests and a leftover call count from an earlier test would
  // silently corrupt the latter.
  beforeEach(() => {
    ;(redirect as unknown as jest.Mock).mockClear()
  })

  it('a 401 (no session) triggers redirect(/login) rather than throwing the /admin/queue error', async () => {
    mockIncomingCookie(undefined)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    await expect(requireAdminQueue()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')

    fetchSpy.mockRestore()
  })

  it('a 403 (signed in, not an admin) ALSO redirects to /login, not a thrown 403 error', async () => {
    mockIncomingCookie('better-auth.session_token=some.value')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 403 }))

    await expect(requireAdminQueue()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')

    fetchSpy.mockRestore()
  })

  it('forwards the incoming Cookie header verbatim to GET /admin/queue', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))

    await requireAdminQueue()

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8081/admin/queue',
      expect.objectContaining({
        method: 'GET',
        headers: { cookie: 'better-auth.session_token=abc123' },
      }),
    )

    fetchSpy.mockRestore()
  })

  it('a 200 response returns the parsed queue array and never calls redirect', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const queue = [
      {
        id: 1,
        userId: 'u1',
        email: 'admin@example.com',
        serviceHost: 'swole.lilnas.io',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        priorDecisions: 0,
      },
    ]
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(queue), { status: 200 }))

    const result = await requireAdminQueue()

    expect(result).toEqual(queue)
    expect(redirect).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('an unexpected non-401/403 error status throws rather than silently redirecting', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }))

    await expect(requireAdminQueue()).rejects.toThrow(
      'lilnas-auth: /admin/queue returned 500',
    )
    expect(redirect).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})

// U8 (R13): fetchAdminServices() shares requireAdminQueue()'s own
// fetchFromAdminApi() helper, whose 401/403/error branches are already
// exhaustively covered above — these tests only prove fetchAdminServices()
// itself calls the RIGHT path and returns the right shape, not every
// branch of the shared helper again.
describe('fetchAdminServices', () => {
  beforeEach(() => {
    ;(redirect as unknown as jest.Mock).mockClear()
  })

  it('calls GET /admin/services and returns the parsed registry', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const services = [
      { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
      { host: 'yacht.lilnas.io', gatedBy: 'lilnas-auth' },
    ]
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(services), { status: 200 }),
      )

    const result = await fetchAdminServices()

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8081/admin/services',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result).toEqual(services)

    fetchSpy.mockRestore()
  })

  it('a 401 redirects to /login, same as requireAdminQueue', async () => {
    mockIncomingCookie(undefined)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    await expect(fetchAdminServices()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')

    fetchSpy.mockRestore()
  })
})
