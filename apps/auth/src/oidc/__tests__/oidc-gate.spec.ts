import { AuthService } from '@thallesp/nestjs-better-auth'
import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { PinoLogger } from 'nestjs-pino'

import { AUTH_PATH_SEGMENT, buildAuth } from 'src/auth/auth'
import { applyPragmas, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { OidcClientsService } from 'src/oidc/oidc-clients.service'
import { decideOidcAccess } from 'src/oidc/oidc-gate'
import { signInAndGetSessionCookiePair } from 'src/verify/__tests__/helpers/session-fixtures'
import { AccessCacheService } from 'src/verify/access-cache.service'
import { VerifyService } from 'src/verify/verify.service'

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

// https:// AUTH_HOST so the id_token `iss` / discovery agree, as in
// oidc-clients.spec.ts.
process.env.AUTH_HOST = 'https://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'
process.env.ADMIN_EMAILS = 'admin@example.com'

const AUTH_HOST = process.env.AUTH_HOST
const SECRET = 'test-app-client-secret'
const REDIRECT_URI = 'https://test-app.lilnas.io/api/auth/oidc/callback'
const TEST_APP = 'test-app.lilnas.io'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, close: () => sqlite.close() }
}

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
  } as unknown as PinoLogger
}

// Real DB, real buildAuth(), real VerifyService wired as verify.service.spec's
// createHarness does. `service` is assigned AFTER buildAuth() — the thunk is
// resolved per request, exactly as auth.module.ts does — and `withService:
// false` makes it resolve to undefined to exercise the fail-closed path.
async function createHarness(withService = true) {
  const t = createTestDb()
  await new OidcClientsService(t.db).onModuleInit()
  let service: VerifyService | undefined
  const auth = buildAuth(t.db, { resolveVerifyService: () => service })
  const cache = new AccessCacheService(
    t.db,
    new AuthService({ auth }),
    fakeLogger(),
  )
  cache.onModuleInit()
  if (withService) service = new VerifyService(cache)

  async function signIn(email: string): Promise<{
    cookie: string
    userId: string
  }> {
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: `sub-${email}`,
      email,
    })
    const row = t.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .get()
    if (!row) throw new Error(`no user row for ${email}`)
    return { cookie, userId: row.id }
  }

  function authorize(cookie: string, clientId = 'test-app') {
    const url =
      `${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/authorize?response_type=code` +
      `&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=openid%20profile%20email&state=xyz`
    return auth.handler(new Request(url, { headers: { cookie } }))
  }

  function exchange(code: string) {
    return auth.handler(
      new Request(`${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: 'test-app',
          client_secret: SECRET,
        }).toString(),
      }),
    )
  }

  function userinfo(accessToken: string) {
    return auth.handler(
      new Request(`${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    )
  }

  const verificationCount = () =>
    t.db.select().from(schema.verification).all().length

  return {
    t,
    cache,
    signIn,
    authorize,
    exchange,
    userinfo,
    verificationCount,
  }
}

function codeFrom(res: Response): string {
  expect(res.status).toBe(302)
  const location = new URL(res.headers.get('location') ?? '')
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI)
  const code = location.searchParams.get('code')
  if (!code) throw new Error('expected an authorization code')
  return code
}

function expectRedirectTo(res: Response, path: string) {
  expect(res.status).toBe(302)
  const location = new URL(res.headers.get('location') ?? '')
  expect(`${location.origin}${location.pathname}`).toBe(`${AUTH_HOST}${path}`)
  expect(location.searchParams.get('redirect')).toBe(`https://${TEST_APP}/`)
  expect(location.searchParams.has('code')).toBe(false)
}

describe('OIDC grant gate on /oauth2/authorize', () => {
  let h: Awaited<ReturnType<typeof createHarness>>

  beforeEach(() => {
    process.env.OIDC_TEST_APP_CLIENT_SECRET = SECRET
  })
  afterEach(() => h?.t.close())

  it('issues a code for a literal grant on the client host', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addGrant(userId, TEST_APP)
    codeFrom(await h.authorize(cookie))
  })

  it('issues a code for an admin email with no grant', async () => {
    h = await createHarness()
    const { cookie } = await h.signIn('admin@example.com')
    codeFrom(await h.authorize(cookie))
  })

  it('issues a code for a matching pattern grant', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addGrant(userId, '*.lilnas.io')
    codeFrom(await h.authorize(cookie))
  })

  it('sends a non-matching pattern grant to /pending, issuing nothing', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addGrant(userId, '*.dev.lilnas.io')
    const before = h.verificationCount()
    const res = await h.authorize(cookie)
    expectRedirectTo(res, '/pending')
    expect(new URL(res.headers.get('location') ?? '').search).toContain(
      'redirect=https%3A%2F%2Ftest-app.lilnas.io%2F',
    )
    expect(h.verificationCount()).toBe(before)
  })

  it('sends a blocked user with a grant to /blocked', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addGrant(userId, TEST_APP)
    h.cache.blockUser(userId)
    expectRedirectTo(await h.authorize(cookie), '/blocked')
  })

  it('sends a user with no grant to /pending and issues no code', async () => {
    h = await createHarness()
    const { cookie } = await h.signIn('alice@example.com')
    const before = h.verificationCount()
    expectRedirectTo(await h.authorize(cookie), '/pending')
    expect(h.verificationCount()).toBe(before)
  })

  it('binds a pending pre-authorization, issues a code and leaves a grant row', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addPreAuthorization('alice@example.com', TEST_APP)
    codeFrom(await h.authorize(cookie))
    expect(
      h.t.db
        .select()
        .from(schema.grant)
        .where(eq(schema.grant.userId, userId))
        .all(),
    ).toHaveLength(1)
  })

  it('issues no code for an unknown client_id', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addGrant(userId, TEST_APP)
    const before = h.verificationCount()
    const res = await h.authorize(cookie, 'nope')
    expect(res.headers.get('location') ?? '').not.toContain('code=')
    expect(res.status).not.toBe(200)
    expect(h.verificationCount()).toBe(before)
  })

  it('fails closed with 403 when VerifyService is unresolvable', async () => {
    h = await createHarness(false)
    const { cookie } = await h.signIn('admin@example.com')
    const before = h.verificationCount()
    const res = await h.authorize(cookie)
    expect(res.status).toBe(403)
    expect(h.verificationCount()).toBe(before)
  })

  it('backstop: a revoked grant blocks the token exchange and userinfo', async () => {
    h = await createHarness()
    const { cookie, userId } = await h.signIn('alice@example.com')
    h.cache.addGrant(userId, TEST_APP)

    // A fully valid first round trip yields a prior access token.
    const first = await h.exchange(codeFrom(await h.authorize(cookie)))
    expect(first.status).toBe(200)
    const { access_token } = (await first.json()) as { access_token: string }
    expect((await h.userinfo(access_token)).status).toBe(200)

    // Second code is issued while granted, then the grant is revoked — the
    // post-login resume path is the one that skips the authorize hook, so
    // the claims callbacks must refuse on their own.
    const code = codeFrom(await h.authorize(cookie))
    h.cache.removeGrant(userId, TEST_APP)

    const exchanged = await h.exchange(code)
    expect(exchanged.status).toBeGreaterThanOrEqual(400)
    const info = await h.userinfo(access_token)
    expect(info.status).toBeGreaterThanOrEqual(400)
  })
})

describe('decideOidcAccess', () => {
  it('denies an unknown client without touching the service', () => {
    const resolve = jest.fn()
    expect(
      decideOidcAccess(resolve, 'nope', { userId: 'u', email: 'e' }),
    ).toEqual({
      outcome: 'deny',
      reason: 'unknown OIDC client "nope"',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('denies when the service is unresolvable', () => {
    expect(
      decideOidcAccess(() => undefined, 'test-app', {
        userId: 'u',
        email: 'e',
      }),
    ).toMatchObject({ outcome: 'deny' })
  })
})
