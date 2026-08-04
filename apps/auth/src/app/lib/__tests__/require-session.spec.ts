import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { fetchMe } from 'src/app/lib/require-session'

process.env.BACKEND_PORT = '8081'

// Mirrors require-admin.spec.ts's own mocking shape exactly — see that
// file's header comment for why redirect() must THROW (not silently
// no-op) to accurately model Next's real, render-unwinding redirect()
// behavior.
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

// fetchMe() is the self-service counterpart to require-admin.spec.ts's
// requireAdminQueue() suite — same shape, minus the 403 case: /me has no
// AdminGuard, so there is only ever the one "no session at all" (401)
// outcome to redirect on.
describe('fetchMe', () => {
  beforeEach(() => {
    ;(redirect as unknown as jest.Mock).mockClear()
  })

  it('a 401 (no session) triggers redirect(/login) rather than throwing the /me error', async () => {
    mockIncomingCookie(undefined)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    await expect(fetchMe()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')

    fetchSpy.mockRestore()
  })

  it('forwards the incoming Cookie header verbatim to GET /me', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

    await fetchMe()

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8081/me',
      expect.objectContaining({
        headers: { cookie: 'better-auth.session_token=abc123' },
      }),
    )

    fetchSpy.mockRestore()
  })

  it('a 200 response returns the parsed profile and never calls redirect', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const me = {
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      isAdmin: false,
      blockedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      grants: ['swole.lilnas.io'],
      pendingRequests: [],
    }
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }))

    const result = await fetchMe()

    expect(result).toEqual(me)
    expect(redirect).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('an unexpected non-401 error status throws rather than silently redirecting', async () => {
    mockIncomingCookie('better-auth.session_token=abc123')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }))

    await expect(fetchMe()).rejects.toThrow('lilnas-auth: /me returned 500')
    expect(redirect).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
