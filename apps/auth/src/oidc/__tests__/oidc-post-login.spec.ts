import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { AUTH_PATH_SEGMENT, buildAuth } from 'src/auth/auth'
import { applyPragmas, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { OidcClientsService } from 'src/oidc/oidc-clients.service'
import type { VerifyService } from 'src/verify/verify.service'

// The real registry is empty; swap in the fixture client.
jest.mock('src/oidc/clients', () => {
  const actual = jest.requireActual('src/oidc/clients')
  const { TEST_OIDC_CLIENT } = jest.requireActual(
    'src/oidc/__tests__/helpers/test-client',
  )
  const clients = [TEST_OIDC_CLIENT]
  return {
    ...actual,
    OIDC_CLIENTS: clients,
    findOidcClient: (id: string) => clients.find(c => c.clientId === id),
    hostForOidcClient: (id: string) =>
      clients.find(c => c.clientId === id)?.host,
  }
})

// https:// AUTH_HOST for the same reason as oidc-clients.spec.ts: the
// plugin forces a non-loopback issuer to https.
process.env.AUTH_HOST = 'https://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'
process.env.OIDC_TEST_APP_CLIENT_SECRET = 'test-app-client-secret'

const AUTH_HOST = process.env.AUTH_HOST
const REDIRECT_URI = 'https://test-app.lilnas.io/api/auth/oidc/callback'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, close: () => sqlite.close() }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

// Same unsigned fake id_token as auth-mount.spec.ts (getUserInfo only
// decodes the payload; see the citation there).
function fakeGoogleIdToken(): string {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64url(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        sub: 'google-sub-post-login',
        email: 'alice@example.com',
        email_verified: true,
        name: 'Test User',
        iat: now,
        exp: now + 3600,
      }),
    ),
    'fake-signature-never-verified-by-getUserInfo',
  ].join('.')
}

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map(c => c.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ')
}

describe('OIDC authorize resumes after the Google round trip', () => {
  let t: ReturnType<typeof createTestDb>
  let auth: ReturnType<typeof buildAuth>
  let fetchSpy: jest.SpyInstance

  beforeEach(async () => {
    t = createTestDb()
    await new OidcClientsService(t.db).onModuleInit()
    // This spec tests the resume plumbing, not the grant gate
    // (oidc-gate.spec.ts owns that), so the gate always allows.
    const allowAll = {
      authorizeHost: () => ({ outcome: 'allow' }),
    } as unknown as VerifyService
    auth = buildAuth(t.db, { resolveVerifyService: () => allowAll })
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (href.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'fake-google-access-token',
            id_token: fakeGoogleIdToken(),
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid email profile',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected fetch call in test: ${href}`)
    })
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    t.close()
  })

  // Authorize with NO cookie: the provider bounces to the login page with a
  // signed query, which is exactly what login-form's oauthProviderClient
  // plugin forwards as `oauth_query`.
  async function authorizeWithoutSession(): Promise<string> {
    const res = await auth.handler(
      new Request(
        `${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/authorize?response_type=code` +
          `&client_id=test-app&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
          `&scope=openid%20profile%20email&state=xyz`,
      ),
    )
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(`${AUTH_HOST}/login`)
    expect(location.searchParams.get('client_id')).toBe('test-app')
    expect(location.searchParams.has('sig')).toBe(true)
    return location.search.slice(1)
  }

  function signInWithOauthQuery(oauthQuery: string) {
    return auth.handler(
      new Request(`${AUTH_HOST}${AUTH_PATH_SEGMENT}/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: '/',
          oauth_query: oauthQuery,
        }),
      }),
    )
  }

  // Completes the Google round trip a sign-in started, returning the
  // callback response (whose Location is the resumed authorize's outcome).
  async function googleCallback(signIn: Response): Promise<Response> {
    expect(signIn.status).toBe(200)
    const state = new URL(
      ((await signIn.json()) as { url: string }).url,
    ).searchParams.get('state')
    expect(state).toBeTruthy()

    return auth.handler(
      new Request(
        `${AUTH_HOST}${AUTH_PATH_SEGMENT}/callback/google?state=${encodeURIComponent(state as string)}&code=fake-google-auth-code`,
        {
          headers: {
            cookie: cookieHeader(signIn.headers.getSetCookie()),
            // A real Google callback is a top-level browser navigation. The
            // plugin's after-hook (oauth-provider
            // dist/authorize-D_jy3s-1.mjs ~L4618) only writes the resumed
            // authorize into the 302 Location for navigations; any other
            // request gets it as a JSON `{ redirect, url }` body with
            // Location left at callbackURL.
            'sec-fetch-mode': 'navigate',
          },
        },
      ),
    )
  }

  it('redirects to the client callback with a code and the original state, not to /', async () => {
    const oauthQuery = await authorizeWithoutSession()
    const callback = await googleCallback(
      await signInWithOauthQuery(oauthQuery),
    )
    expect(callback.status).toBeGreaterThanOrEqual(300)
    expect(callback.status).toBeLessThan(400)
    const location = new URL(callback.headers.get('location') ?? '', AUTH_HOST)
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI)
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(location.searchParams.get('state')).toBe('xyz')
  })

  // The resumed authorize runs the app's own hooks.before (layer 1 of the
  // grant gate, auth.ts), so an ungranted user is turned away here instead of
  // being handed a code that only the token endpoint (layer 2) would refuse.
  it('runs the authorize gate on the resumed authorize: a pending user gets /pending, no code', async () => {
    const pendingUrl = `${AUTH_HOST}/pending?redirect=https%3A%2F%2Ftest-app.lilnas.io%2F`
    const authorizeHost = jest.fn(() => ({
      outcome: 'pending',
      location: pendingUrl,
    }))
    auth = buildAuth(t.db, {
      resolveVerifyService: () =>
        ({ authorizeHost }) as unknown as VerifyService,
    })

    const oauthQuery = await authorizeWithoutSession()
    const callback = await googleCallback(
      await signInWithOauthQuery(oauthQuery),
    )
    expect(authorizeHost).toHaveBeenCalledTimes(1)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe(pendingUrl)
    expect(callback.headers.get('location')).not.toContain('code=')
  })

  it('rejects a tampered sig and issues no code', async () => {
    const params = new URLSearchParams(await authorizeWithoutSession())
    params.set('sig', `${params.get('sig')}tampered`)
    const signIn = await signInWithOauthQuery(params.toString())

    expect(signIn.status).toBeGreaterThanOrEqual(400)
    expect(signIn.status).toBeLessThan(500)
    expect(await signIn.text()).not.toContain('code=')
    expect(signIn.headers.get('location') ?? '').not.toContain('code=')
  })
})
