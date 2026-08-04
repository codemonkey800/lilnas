import http from 'node:http'

import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { AUTH_PATH_SEGMENT, buildAuth } from 'src/auth/auth'
import { AuthModule } from 'src/auth/auth.module'
import {
  applyPragmas,
  DB,
  type Db,
  runMigrations,
} from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { EnvKeys } from 'src/env'

// Obviously-fake test values, scoped to this file only (module-scope
// process.env assignment), mirroring
// apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts's own convention.
// AUTH_HOST deliberately uses http:// here, matching this app's own dev
// value in .env.example — it is what the primary describe block's app
// instance below exercises, AND it doubles as the negative case for the
// Secure-cookie attribute (a separate https:// instance, built later in
// this file, supplies the positive case).
process.env.AUTH_HOST = 'http://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
// U4: buildAuth() now reads this to build `trustedOrigins` (see auth.ts's
// U4-added comment) — 'localhost.test' matches AUTH_HOST's own domain
// family above, so 'swole.localhost.test' is a valid subdomain under it.
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

// Mirrors DatabaseModule's shape (DatabaseModule itself is @Global() and
// exports DB) so AuthModule's forRootAsync({ inject: [DB], ... }) factory
// resolves DB without the test module needing anything extra — same
// pattern as apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts's
// makeTestDatabaseModule().
function makeTestDatabaseModule(db: Db) {
  @Global()
  @Module({
    providers: [{ provide: DB, useValue: db }],
    exports: [DB],
  })
  class TestDatabaseModule {}
  return TestDatabaseModule
}

type JsonResponse = {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
  rawBody: string
}

// No supertest in this workspace (confirmed, matching
// apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts's own note) — a tiny
// http.request wrapper is enough for the black-box assertions this suite
// needs.
function request(
  port: number,
  options: {
    method: string
    path: string
    headers?: Record<string, string>
    body?: string
  },
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk as Buffer))
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8')
          let body: unknown = undefined
          try {
            body = rawBody.length > 0 ? JSON.parse(rawBody) : undefined
          } catch {
            body = rawBody
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            rawBody,
          })
        })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

async function startTestApp(db: Db) {
  const TestDatabaseModule = makeTestDatabaseModule(db)

  @Module({
    imports: [TestDatabaseModule, AuthModule],
  })
  class TestAppModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile()

  // bodyParser: false is the exact flag src/bootstrap.ts now passes to
  // NestFactory.create (a U3 fix — see this unit's report for why: Nest's
  // own global body parser, on by default, would otherwise consume the raw
  // request body before AuthModule's own SkipBodyParsingMiddleware ever
  // gets a chance to skip it for the '/api/auth' mount). Mirrored here so
  // this test app matches the real bootstrap exactly.
  const nestApp = moduleRef.createNestApplication({ bodyParser: false })
  await nestApp.init()
  await nestApp.listen(0, '127.0.0.1')

  const address = nestApp.getHttpServer().address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected app to listen on a resolved TCP address')
  }

  return { app: nestApp, port: address.port }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

// Fabricates a Google id_token good enough for getUserInfo() to accept: the
// standard authorization-code callback path decodes this JWT's payload
// (jose's decodeJwt) WITHOUT verifying the signature — confirmed against
// the installed @better-auth/core's src/social-providers/google.ts:
// getUserInfo() only ever calls decodeJwt(token.idToken); signature
// verification (verifyIdToken) is a SEPARATE method used only by the
// id-token/one-tap sign-in flow, which this app's callback flow never
// invokes. The trailing "signature" segment below is therefore never
// validated and can be any non-empty base64url string.
function fakeGoogleIdToken(profile: { sub: string; email: string }): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: profile.sub,
      email: profile.email,
      email_verified: true,
      name: 'Test User',
      given_name: 'Test',
      family_name: 'User',
      picture: 'https://example.com/avatar.png',
      iat: now,
      exp: now + 3600,
    }),
  )
  return `${header}.${payload}.fake-signature-never-verified-by-getUserInfo`
}

// Mocks ONLY the network boundary this app doesn't own — Google's own
// endpoints — the same "fake the third party, drive our own code for real"
// pattern
// apps/tdr-code/src/console/__tests__/github-link.service.spec.ts uses for
// GitHub's revoke endpoint. Everything else (state generation, PKCE, the
// callback route, session creation, cookie construction) runs through the
// REAL buildAuth() instance. `respond` decides the token-endpoint response
// per test — a success body for the happy-path cookie test, an error
// status for the onAPIError redirect test.
function mockGoogleTokenExchange(respond: () => Response): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async input => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (href.startsWith('https://oauth2.googleapis.com/token')) {
      return respond()
    }
    throw new Error(`Unexpected fetch call in test: ${href}`)
  })
}

// Better Auth's DEFAULT "database" OAuth state strategy is not purely
// server-side: confirmed against installed better-auth@1.6.23's
// dist/state.mjs (parseGenericState's non-cookie branch) — alongside the
// `verification` DB row, it ALSO sets and re-checks a SIGNED `state` cookie
// as defense-in-depth (`state_security_mismatch` / "State not persisted
// correctly" if it's missing or mismatched), unless `skipStateCookieCheck`
// is set (this app doesn't set it). A real browser carries that cookie
// automatically between the sign-in redirect and the callback request;
// these black-box test helpers have to do the same explicitly. Extracts
// just the `name=value` pairs (before each cookie's first `;`) from a set
// of Set-Cookie headers, joined the way a browser's own Cookie header would
// be.
function cookieHeaderFromSetCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map(cookie => cookie.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ')
}

async function initiateGoogleSignIn(
  port: number,
): Promise<{ authorizeURL: URL; state: string; cookie: string }> {
  const res = await request(port, {
    method: 'POST',
    path: '/api/auth/sign-in/social',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
  })
  const body = res.body as { url: string }
  const authorizeURL = new URL(body.url)
  const state = authorizeURL.searchParams.get('state')
  if (!state) throw new Error('expected sign-in response to carry a state')
  const cookie = cookieHeaderFromSetCookies(res.headers['set-cookie'] ?? [])
  return { authorizeURL, state, cookie }
}

describe('Better Auth NestJS mount (U3)', () => {
  let testDb: ReturnType<typeof createTestDb>
  let app: { close: () => Promise<void> }
  let port: number

  beforeAll(async () => {
    testDb = createTestDb()
    const started = await startTestApp(testDb.db)
    app = started.app
    port = started.port
  })

  afterAll(async () => {
    await app.close()
    testDb.close()
  })

  describe('basePath / baseURL invariant (the non-stripping-rewrite design)', () => {
    // This is the property that makes next.config.js's non-stripping
    // '/api/auth/:path*' rewrite correct: with both values equal, NestJS
    // seeing the exact path the browser sent is sufficient for BOTH
    // @thallesp's own mount gate (reads `basePath` directly) and Better
    // Auth's internal router (derives its own prefix from
    // `new URL(baseURL).pathname`) to agree — see src/auth/auth.ts's
    // AUTH_PATH_SEGMENT comment for the full citation trail.
    it('the built instance has basePath and baseURL pathname both exactly "/api/auth"', () => {
      const auth = buildAuth(testDb.db)
      expect(auth.options.basePath).toBe(AUTH_PATH_SEGMENT)
      expect(auth.options.baseURL).toBeDefined()
      expect(new URL(auth.options.baseURL as string).pathname).toBe(
        AUTH_PATH_SEGMENT,
      )
    })
  })

  describe('sign-in initiation', () => {
    it('POST /api/auth/sign-in/social with provider "google" returns a Google authorize redirect whose redirect_uri is byte-identical to what must be registered in the Google console', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      })

      expect(res.status).toBe(200)
      const body = res.body as { url?: string; redirect?: boolean }
      expect(typeof body.url).toBe('string')
      expect(body.redirect).toBe(true)
      // signInSocial also sets a Location header alongside the JSON body —
      // same URL, belt-and-suspenders check (mirrors
      // apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts's identical
      // assertion).
      expect(res.headers.location).toBe(body.url)

      const authorizeURL = new URL(body.url as string)
      expect(authorizeURL.origin).toBe('https://accounts.google.com')
      expect(authorizeURL.searchParams.get('client_id')).toBe(
        process.env.GOOGLE_CLIENT_ID,
      )
      // The exact property this test scenario is about: this MUST equal
      // `${AUTH_HOST}/api/auth/callback/google` — the URL that has to be
      // registered as an authorized redirect URI in the Google Cloud
      // console for a real sign-in to ever succeed. Confirmed against
      // installed better-auth@1.6.23's dist/api/routes/sign-in.mjs:
      // `redirectURI: \`${c.context.baseURL}/callback/${provider.id}\``.
      expect(authorizeURL.searchParams.get('redirect_uri')).toBe(
        `${process.env.AUTH_HOST}${AUTH_PATH_SEGMENT}/callback/google`,
      )
      // Google's provider defaults to ['email', 'profile', 'openid'] with
      // no extra scope configured (src/auth/auth.ts deliberately adds
      // none) — sorted comparison since scope ORDER isn't a property this
      // unit depends on, only membership.
      const scopes = authorizeURL.searchParams.get('scope')?.split(' ') ?? []
      expect(scopes.slice().sort()).toEqual(
        ['email', 'openid', 'profile'].sort(),
      )
    })
  })

  describe('trustedOrigins covers cross-subdomain callbackURLs (U4 fix)', () => {
    // U3 originally left trustedOrigins unset on the (then-correct)
    // assumption that this app's login page only ever passes a same-origin
    // relative callbackURL. U4's src/auth/redirect.ts made that assumption
    // false — resolveRedirectTarget() can return a validated
    // CROSS-SUBDOMAIN absolute URL, which is R3's entire point. Without a
    // trustedOrigins entry covering the domain family, Better Auth's own
    // origin-check middleware would reject exactly that URL with
    // INVALID_CALLBACK_URL, silently breaking R3's primary case even though
    // redirect.ts itself already approved it. This test drives a REAL
    // request through the REAL mount to prove the fix, not just that
    // auth.ts's trustedOrigins array contains the right strings.
    it('accepts a callbackURL on a different subdomain within the allowed suffix', async () => {
      // Scheme MUST match this file's AUTH_HOST ('http://...' — see the
      // module-scope process.env block above): trustedOrigins' scheme
      // prefix is derived from authOrigin.protocol (auth.ts), so an
      // https:// candidate here would be rejected for a mismatched scheme,
      // not proving anything about the suffix-matching this test targets.
      // A real login/page.tsx never produces this mismatch — redirect.ts
      // enforces the same scheme-parity rule before a candidate ever
      // reaches this endpoint.
      const res = await request(port, {
        method: 'POST',
        path: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: 'http://swole.localhost.test/some/path',
        }),
      })

      expect(res.status).toBe(200)
      const body = res.body as { url?: string; redirect?: boolean }
      expect(typeof body.url).toBe('string')
    })

    it('still rejects a callbackURL outside the allowed suffix (trustedOrigins does not become permissive)', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: 'http://evil.example.com/',
        }),
      })

      expect(res.status).toBe(403)
      expect(res.rawBody).toContain('INVALID_CALLBACK_URL')
    })

    it('allows the bare apex of the allowed suffix, not just subdomains', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/auth/sign-in/social',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: 'http://localhost.test/',
        }),
      })

      expect(res.status).toBe(200)
    })
  })

  describe('non-stripping rewrite design (the stripped form must NOT match)', () => {
    // Inverse of apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts's own
    // "unknown path under /auth/* still reaches the Better Auth handler"
    // test — tdr-code asserts its STRIPPED form reaches the handler
    // (because its rewrite strips '/api'); this app's rewrite does NOT
    // strip, so the stripped form here must NOT match this app's
    // '/api/auth' basePath at all, and the request should fall straight
    // through to Nest's own routing (which has no controller for it) —
    // proving the rewrite design, not merely exercising the opposite
    // assertion by copy-paste mistake.
    it('GET /auth/session (the STRIPPED form, missing the /api prefix) 404s as a genuine Nest 404, never reaching the Better Auth handler', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/auth/session',
      })

      expect(res.status).toBe(404)
      // Nest's own default 404 body is JSON shaped like
      // {"statusCode":404,"message":"Cannot GET /auth/session",...} —
      // Better Auth's own router 404s an unmatched path with an EMPTY body
      // instead (confirmed empirically in
      // apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts). Asserting the
      // presence of "statusCode" distinguishes "never reached the mount at
      // all" (this app's correct behavior for the stripped form) from "the
      // mount gate incorrectly passed it through and Better Auth 404'd
      // internally" (which would indicate the rewrite is stripping after
      // all).
      expect(res.rawBody).toContain('statusCode')
    })
  })

  describe('completed Google callback', () => {
    it('issues a session cookie with Domain=<COOKIE_DOMAIN>, HttpOnly, SameSite=Lax, and no Secure attribute over a plain-http AUTH_HOST', async () => {
      const { state, cookie } = await initiateGoogleSignIn(port)

      const idToken = fakeGoogleIdToken({
        sub: 'google-subject-http-test',
        email: 'sign-in-test@example.com',
      })
      const fetchSpy = mockGoogleTokenExchange(
        () =>
          new Response(
            JSON.stringify({
              access_token: 'fake-google-access-token',
              id_token: idToken,
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'openid email profile',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      )
      try {
        const callbackRes = await request(port, {
          method: 'GET',
          path: `/api/auth/callback/google?state=${encodeURIComponent(state)}&code=fake-google-auth-code`,
          headers: { cookie },
        })

        // A successful callback redirects the browser to the (relative)
        // callbackURL — the exact status code (302/303/307) isn't a
        // property this unit depends on, only that it's a redirect.
        expect(callbackRes.status).toBeGreaterThanOrEqual(300)
        expect(callbackRes.status).toBeLessThan(400)

        const setCookieHeaders = callbackRes.headers['set-cookie'] ?? []
        const sessionCookie = setCookieHeaders.find(cookie =>
          cookie.includes('session_token'),
        )
        expect(sessionCookie).toBeDefined()

        const attrs = sessionCookie!.split(';').map(part => part.trim())
        expect(attrs).toContain(`Domain=${process.env.COOKIE_DOMAIN}`)
        expect(attrs).toContain('HttpOnly')
        expect(attrs.some(a => a.toLowerCase() === 'samesite=lax')).toBe(true)
        // The negative case for the Secure-attribute finding below — see
        // "Secure cookie attribute" describe block for the positive case
        // and the citation for why this is keyed off AUTH_HOST's own
        // scheme, not this request's.
        expect(attrs.some(a => a.toLowerCase() === 'secure')).toBe(false)
      } finally {
        fetchSpy.mockRestore()
      }
    })

    it('a failed Google token exchange redirects to /login?error=<code> (onAPIError), never to the bare Better Auth /api/auth/error page', async () => {
      const { state, cookie } = await initiateGoogleSignIn(port)

      const fetchSpy = mockGoogleTokenExchange(
        () => new Response('invalid_grant', { status: 400 }),
      )
      try {
        const callbackRes = await request(port, {
          method: 'GET',
          path: `/api/auth/callback/google?state=${encodeURIComponent(state)}&code=fake-google-auth-code`,
          headers: { cookie },
        })

        expect(callbackRes.status).toBeGreaterThanOrEqual(300)
        expect(callbackRes.status).toBeLessThan(400)
        const location = callbackRes.headers.location
        expect(location).toBeDefined()
        expect(location).toContain(`${process.env.AUTH_HOST}/login`)
        expect(location).toContain('error=')
        expect(location).not.toContain('/api/auth/error')
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })
})

describe('onAPIError config points at the login page', () => {
  it("errorURL is this app's own /login, not the library default", () => {
    const testDb = createTestDb()
    try {
      const auth = buildAuth(testDb.db)
      expect(auth.options.onAPIError?.errorURL).toBe(
        `${process.env.AUTH_HOST}/login`,
      )
    } finally {
      testDb.close()
    }
  })
})

describe("Secure cookie attribute reflects AUTH_HOST's own scheme, not the request's", () => {
  // Verified against installed better-auth@1.6.23's dist/cookies/index.mjs:
  // the Secure attribute is derived from whether the STATIC `baseURL`
  // string starts with 'https://' — decided once at buildAuth() time from
  // AUTH_HOST's configured scheme — NOT from the incoming request's own
  // scheme or an X-Forwarded-Proto header. This is a MORE PRECISE finding
  // than "Secure only when the request is https": it is actually "Secure
  // only when AUTH_HOST's own scheme is https." This matters for the real
  // deployment, where Traefik terminates TLS and forwards plain http to
  // this container — a per-request-scheme rule would have produced
  // `secure: false` in production; the actual, verified rule instead keys
  // off AUTH_HOST (https:// in prod, http:// in dev), which is correct in
  // both environments without this app ever needing to trust a
  // forwarded-proto header for it.
  it('sets Secure when AUTH_HOST is https, driven through a real callback exactly like the http case above', async () => {
    const originalAuthHost = process.env.AUTH_HOST
    process.env.AUTH_HOST = 'https://login.lilnas-auth-test.example'
    const testDb = createTestDb()
    try {
      const auth = buildAuth(testDb.db)
      expect(auth.options.baseURL?.startsWith('https://')).toBe(true)

      const signInResponse = await auth.handler(
        new Request(
          `${process.env.AUTH_HOST}${AUTH_PATH_SEGMENT}/sign-in/social`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
          },
        ),
      )
      const signInBody = (await signInResponse.json()) as { url: string }
      const state = new URL(signInBody.url).searchParams.get('state')
      expect(state).toBeTruthy()
      // See cookieHeaderFromSetCookies's own comment above: Better Auth's
      // default "database" state strategy also re-checks a signed `state`
      // cookie set on the sign-in response, so it must be carried forward
      // onto the callback request exactly as a real browser would.
      const signInCookie = cookieHeaderFromSetCookies(
        signInResponse.headers.getSetCookie(),
      )

      const idToken = fakeGoogleIdToken({
        sub: 'google-subject-https-test',
        email: 'https-sign-in-test@example.com',
      })
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'fake-google-access-token',
              id_token: idToken,
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'openid email profile',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      )
      try {
        const callbackResponse = await auth.handler(
          new Request(
            `${process.env.AUTH_HOST}${AUTH_PATH_SEGMENT}/callback/google?state=${encodeURIComponent(state as string)}&code=fake-google-auth-code`,
            { headers: { cookie: signInCookie } },
          ),
        )
        const setCookies = callbackResponse.headers.getSetCookie()
        const sessionCookie = setCookies.find(cookie =>
          cookie.includes('session_token'),
        )
        expect(sessionCookie).toBeDefined()
        const attrs = sessionCookie!.split(';').map(part => part.trim())
        expect(attrs.some(a => a.toLowerCase() === 'secure')).toBe(true)
      } finally {
        fetchSpy.mockRestore()
      }
    } finally {
      process.env.AUTH_HOST = originalAuthHost
      testDb.close()
    }
  })
})

describe('buildAuth() env validation (fail fast at boot)', () => {
  // buildAuth()'s object-literal construction evaluates env(EnvKeys.X)
  // calls eagerly (left-to-right, synchronously) before betterAuth() itself
  // ever runs — so a missing required key throws synchronously out of
  // buildAuth(), not a silent misconfiguration discovered later at request
  // time. Mirrors
  // apps/tdr-code/src/auth/__tests__/auth-mount.spec.ts's identical suite.
  let testDb: ReturnType<typeof createTestDb>

  beforeAll(() => {
    testDb = createTestDb()
  })

  afterAll(() => {
    testDb.close()
  })

  it.each([
    EnvKeys.AUTH_HOST,
    EnvKeys.GOOGLE_CLIENT_ID,
    EnvKeys.GOOGLE_CLIENT_SECRET,
    EnvKeys.BETTER_AUTH_SECRET,
    EnvKeys.COOKIE_DOMAIN,
    EnvKeys.REDIRECT_ALLOWED_SUFFIX,
  ])('missing %s fails buildAuth() fast with a clear error message', key => {
    const original = process.env[key]
    delete process.env[key]
    try {
      expect(() => buildAuth(testDb.db)).toThrow(`${key} not defined`)
    } finally {
      // Node stringifies `undefined` assigned to process.env[key] to the
      // literal string "undefined" rather than deleting it — guard against
      // that footgun even though `original` is always defined today (all
      // five keys are set at module scope above, before this describe
      // block runs).
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  })
})
