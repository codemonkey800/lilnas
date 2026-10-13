import BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'

import { AUTH_PATH_SEGMENT, buildAuth } from 'src/auth/auth'
import { applyPragmas, runMigrations } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { findOidcClient, hostForOidcClient } from 'src/oidc/clients'
import { OidcClientsService } from 'src/oidc/oidc-clients.service'
import { signInAndGetSessionCookiePair } from 'src/verify/__tests__/helpers/session-fixtures'
import type { VerifyService } from 'src/verify/verify.service'

// https:// AUTH_HOST for the same reason as oidc-discovery.spec.ts: the
// plugin forces a non-loopback issuer to https, and the id_token's `iss`
// must equal AUTH_HOST.
process.env.AUTH_HOST = 'https://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'

const AUTH_HOST = process.env.AUTH_HOST
const SECRET = 'test-penpot-client-secret'
const REDIRECT_URI = 'https://penpot.lilnas.io/api/auth/oidc/callback'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, close: () => sqlite.close() }
}

function rows(db: ReturnType<typeof createTestDb>['db']) {
  return db.select().from(schema.oauthClient).all()
}

describe('OIDC client registry', () => {
  it('maps client ids to lilnas hosts', () => {
    expect(findOidcClient('penpot')?.name).toBe('Penpot')
    expect(hostForOidcClient('penpot')).toBe('penpot.lilnas.io')
    expect(hostForOidcClient('nope')).toBeUndefined()
  })
})

describe('OidcClientsService seeding', () => {
  let t: ReturnType<typeof createTestDb>

  beforeEach(() => {
    process.env.OIDC_PENPOT_CLIENT_SECRET = SECRET
    t = createTestDb()
  })
  afterEach(() => t.close())

  it('seeds the penpot client with the expected shape', async () => {
    await new OidcClientsService(t.db).onModuleInit()
    const [row] = rows(t.db)
    expect(row).toMatchObject({
      clientId: 'penpot',
      name: 'Penpot',
      type: 'web',
      tokenEndpointAuthMethod: 'client_secret_post',
      skipConsent: true,
      requirePKCE: false,
      public: false,
      disabled: false,
    })
    // Never the plaintext.
    expect(row?.clientSecret).not.toBe(SECRET)
    expect(JSON.parse(row?.redirectUris ?? '')).toEqual([REDIRECT_URI])
    expect(JSON.parse(row?.scopes ?? '')).toEqual([
      'openid',
      'profile',
      'email',
    ])
    expect(JSON.parse(row?.grantTypes ?? '')).toEqual(['authorization_code'])
    expect(JSON.parse(row?.responseTypes ?? '')).toEqual(['code'])
    expect(JSON.parse(row?.metadata ?? '')).toEqual({
      lilnasHost: 'penpot.lilnas.io',
    })
  })

  it('is idempotent and applies a changed secret on the next call', async () => {
    const service = new OidcClientsService(t.db)
    await service.onModuleInit()
    const [first] = rows(t.db)
    await service.onModuleInit()
    expect(rows(t.db)).toHaveLength(1)
    expect(rows(t.db)[0]?.clientSecret).toBe(first?.clientSecret)

    process.env.OIDC_PENPOT_CLIENT_SECRET = 'rotated-secret'
    await service.onModuleInit()
    const [second] = rows(t.db)
    expect(rows(t.db)).toHaveLength(1)
    expect(second?.id).toBe(first?.id)
    expect(second?.createdAt).toEqual(first?.createdAt)
    expect(second?.clientSecret).not.toBe(first?.clientSecret)
  })

  it('refreshes redirect URIs on an existing row', async () => {
    const service = new OidcClientsService(t.db)
    await service.onModuleInit()
    t.db
      .update(schema.oauthClient)
      .set({ redirectUris: JSON.stringify(['https://stale.example/cb']) })
      .where(eq(schema.oauthClient.clientId, 'penpot'))
      .run()
    await service.onModuleInit()
    expect(JSON.parse(rows(t.db)[0]?.redirectUris ?? '')).toEqual([
      REDIRECT_URI,
    ])
  })

  it('throws naming the env key when the secret is unset', async () => {
    delete process.env.OIDC_PENPOT_CLIENT_SECRET
    await expect(new OidcClientsService(t.db).onModuleInit()).rejects.toThrow(
      /OIDC_PENPOT_CLIENT_SECRET/,
    )
  })
})

describe('authorization-code flow against the seeded penpot client', () => {
  let t: ReturnType<typeof createTestDb>
  let auth: ReturnType<typeof buildAuth>

  beforeEach(async () => {
    process.env.OIDC_PENPOT_CLIENT_SECRET = SECRET
    t = createTestDb()
    await new OidcClientsService(t.db).onModuleInit()
    // This block tests the plugin's protocol behaviour, not the grant gate
    // (oidc-gate.spec.ts owns that), so the gate always allows.
    const allowAll = {
      authorizeHost: () => ({ outcome: 'allow' }),
    } as unknown as VerifyService
    auth = buildAuth(t.db, { resolveVerifyService: () => allowAll })
  })
  afterEach(() => t.close())

  async function authorize(cookie: string, redirectUri = REDIRECT_URI) {
    const url =
      `${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/authorize?response_type=code` +
      `&client_id=penpot&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=openid%20profile%20email&state=xyz`
    return auth.handler(new Request(url, { headers: { cookie } }))
  }

  function exchange(code: string, clientSecret: string) {
    return auth.handler(
      new Request(`${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: 'penpot',
          client_secret: clientSecret,
        }).toString(),
      }),
    )
  }

  async function signInAndGetCode(): Promise<string> {
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-1',
      email: 'alice@example.com',
    })
    const res = await authorize(cookie)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI)
    expect(location.searchParams.get('state')).toBe('xyz')
    expect(location.searchParams.get('iss')).toBeTruthy()
    const code = location.searchParams.get('code')
    if (!code) throw new Error('expected an authorization code')
    return code
  }

  it('issues a verifiable id_token and serves userinfo', async () => {
    const code = await signInAndGetCode()
    const res = await exchange(code, SECRET)
    expect(res.status).toBe(200)
    const tokens = (await res.json()) as {
      access_token: string
      id_token: string
    }
    expect(tokens.access_token).toBeTruthy()

    const claims = decodeJwt(tokens.id_token)
    expect(claims.iss).toBe(AUTH_HOST)
    expect([claims.aud].flat()).toContain('penpot')
    expect(claims).toMatchObject({
      email: 'alice@example.com',
      email_verified: true,
      name: 'Test User',
    })

    const jwksRes = await auth.handler(
      new Request(`${AUTH_HOST}${AUTH_PATH_SEGMENT}/jwks`),
    )
    const jwks = createLocalJWKSet(
      (await jwksRes.json()) as Parameters<typeof createLocalJWKSet>[0],
    )
    await expect(jwtVerify(tokens.id_token, jwks)).resolves.toBeDefined()

    const infoRes = await auth.handler(
      new Request(`${AUTH_HOST}${AUTH_PATH_SEGMENT}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    )
    expect(infoRes.status).toBe(200)
    expect(await infoRes.json()).toMatchObject({
      sub: claims.sub,
      email: 'alice@example.com',
      email_verified: true,
      name: 'Test User',
    })
  })

  it('rejects a wrong client_secret with 401', async () => {
    const code = await signInAndGetCode()
    const res = await exchange(code, 'wrong-secret')
    expect(res.status).toBe(401)
  })

  it('does not issue a code for an unregistered redirect_uri', async () => {
    const cookie = await signInAndGetSessionCookiePair(auth, AUTH_HOST, {
      sub: 'google-sub-1',
      email: 'alice@example.com',
    })
    const res = await authorize(cookie, 'https://evil.example/cb')
    // The plugin never redirects to an unvalidated URI: it bounces to its
    // own login page with an error and no code.
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin).toBe(AUTH_HOST)
    expect(location.searchParams.get('error')).toBe('invalid_redirect')
    expect(location.searchParams.has('code')).toBe(false)
  })
})
