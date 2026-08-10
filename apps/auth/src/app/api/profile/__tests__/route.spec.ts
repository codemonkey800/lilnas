import { GET, OPTIONS } from 'src/app/api/profile/route'

process.env.BACKEND_PORT = '8081'

const REQUEST_URL = 'https://auth.lilnas.io/api/profile'

function makeRequest(headers: Record<string, string>): Request {
  return new Request(REQUEST_URL, { headers })
}

// A full MeResponse (src/me/me.controller.ts) — deliberately includes every
// field beyond {name, email, image} so the "exactly three keys" test below
// actually proves something rather than trivially passing against an
// already-slim fixture.
const ME_RESPONSE = {
  name: 'Test User',
  email: 'test@example.com',
  image: 'https://example.com/avatar.png',
  isAdmin: true,
  blockedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  grants: ['swole.lilnas.io'],
  pendingRequests: [
    { serviceHost: 'dashcam.lilnas.io', createdAt: '2026-01-02T00:00:00.000Z' },
  ],
}

// The self-service counterpart to require-session.spec.ts's fetchMe() suite
// — same module-scope process.env + per-case jest.spyOn(global, 'fetch')
// shape, but exercised through the actual Route Handler functions rather
// than a server-side helper, since this route's whole reason to exist is
// its own response headers (require-session.ts's fetchMe() has none).
describe('GET /api/profile', () => {
  afterEach(() => {
    delete process.env.PROFILE_ALLOWED_ORIGINS
  })

  it('echoes Access-Control-Allow-Origin, Allow-Credentials, and Vary for a listed origin', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS =
      'http://localhost:5173,http://localhost:8765'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Vary')).toBe('Origin')

    fetchSpy.mockRestore()
  })

  it('omits Access-Control-Allow-Origin entirely for an unlisted origin', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS =
      'http://localhost:5173,http://localhost:8765'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    const res = await GET(makeRequest({ origin: 'https://evil.example.com' }))

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('still serves a same-origin request with no CORS headers when there is no Origin header', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS =
      'http://localhost:5173,http://localhost:8765'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(ME_RESPONSE), { status: 200 }),
      )

    const res = await GET(makeRequest({}))

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Vary')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('fails closed with no Access-Control-Allow-Origin when PROFILE_ALLOWED_ORIGINS is unset', async () => {
    delete process.env.PROFILE_ALLOWED_ORIGINS
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('a literal wildcard allowlist entry matches nothing — the trustedOrigins trap', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'https://*.lilnas.io'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    const res = await GET(
      makeRequest({ origin: 'https://nexus-code.lilnas.io' }),
    )

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('returns exactly {name, email, image} — no session/admin/grants fields leak through', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(ME_RESPONSE), { status: 200 }),
      )

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))
    const body = (await res.json()) as Record<string, unknown>

    expect(body).toEqual({
      name: ME_RESPONSE.name,
      email: ME_RESPONSE.email,
      image: ME_RESPONSE.image,
    })
    expect(Object.keys(body).sort()).toEqual(['email', 'image', 'name'])

    fetchSpy.mockRestore()
  })

  it('forwards the incoming Cookie header verbatim to GET http://localhost:8081/me', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(ME_RESPONSE), { status: 200 }),
      )

    await GET(
      makeRequest({
        origin: 'http://localhost:5173',
        cookie: 'better-auth.session_token=abc123',
      }),
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8081/me',
      expect.objectContaining({
        headers: { cookie: 'better-auth.session_token=abc123' },
      }),
    )

    fetchSpy.mockRestore()
  })

  it('passes an internal 401 through as a 401, with CORS headers still attached, not a redirect', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }))

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )

    fetchSpy.mockRestore()
  })

  it('passes an internal 5xx through as a 502, with CORS headers still attached', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }))

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.status).toBe(502)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )

    fetchSpy.mockRestore()
  })

  it('a fetch-level failure still returns a response with CORS headers attached, not an uncaught throw', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.status).toBe(500)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )

    fetchSpy.mockRestore()
  })

  it('always sets Cache-Control: no-store, since the payload is per-user data', async () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(ME_RESPONSE), { status: 200 }),
      )

    const res = await GET(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.headers.get('Cache-Control')).toBe('no-store')

    fetchSpy.mockRestore()
  })
})

describe('OPTIONS /api/profile', () => {
  afterEach(() => {
    delete process.env.PROFILE_ALLOWED_ORIGINS
  })

  it('returns a 204 with CORS + method/max-age headers for a listed origin', () => {
    process.env.PROFILE_ALLOWED_ORIGINS = 'http://localhost:5173'

    const res = OPTIONS(makeRequest({ origin: 'http://localhost:5173' }))

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET')
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
  })
})
