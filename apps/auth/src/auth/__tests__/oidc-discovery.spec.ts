import http from 'node:http'

import { Global, type INestApplication, Module } from '@nestjs/common'
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
import { signInAndGetSessionCookiePair } from 'src/verify/__tests__/helpers/session-fixtures'

// Same obviously-fake, file-scoped env as auth-mount.spec.ts, except
// AUTH_HOST is https://: the oauth-provider plugin forces a non-loopback
// issuer to https (dist/index.mjs: `if (url.protocol !== "https:" &&
// !isLoopbackHost(url.host)) url.protocol = "https:"`), so an http://
// non-loopback AUTH_HOST would never equal the advertised issuer.
process.env.AUTH_HOST = 'https://login.localhost.test'
process.env.COOKIE_DOMAIN = '.localhost.test'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'

const AUTH_HOST = process.env.AUTH_HOST

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

type JsonResponse = { status: number; body: unknown; rawBody: string }

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path, headers },
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
          resolve({ status: res.statusCode ?? 0, body, rawBody })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// Boots the REAL Nest mount (AuthModule + buildAuth) on a random port, as
// auth-mount.spec.ts does; bodyParser: false mirrors src/bootstrap.ts.
async function startTestApp(db: Db) {
  @Global()
  @Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
  class TestDatabaseModule {}

  @Module({ imports: [TestDatabaseModule, AuthModule] })
  class TestAppModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile()
  const app = moduleRef.createNestApplication({ bodyParser: false })
  await app.init()
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected app to listen on a resolved TCP address')
  }
  return { app, port: address.port }
}

describe('OIDC provider mount', () => {
  let app: INestApplication
  let port: number
  let db: Db
  let close: () => void

  beforeAll(async () => {
    const created = createTestDb()
    db = created.db
    close = created.close
    ;({ app, port } = await startTestApp(db))
  })

  afterAll(async () => {
    await app.close()
    close()
  })

  it('serves the OpenID discovery document with absolute endpoints under the auth base', async () => {
    // Root path: the plugin only answers discovery there (see
    // OidcWellKnownController); next.config.js rewrites it unchanged.
    const res = await get(port, '/.well-known/openid-configuration')

    expect(res.status).toBe(200)
    const doc = res.body as Record<string, unknown>
    // The issuer is the bare origin (AUTH_HOST), not the /api/auth base.
    expect(doc.issuer).toBe(AUTH_HOST)
    for (const key of [
      'authorization_endpoint',
      'token_endpoint',
      'userinfo_endpoint',
      'jwks_uri',
    ]) {
      expect(typeof doc[key]).toBe('string')
      expect(doc[key] as string).toMatch(
        new RegExp(`^${AUTH_HOST}${AUTH_PATH_SEGMENT}/`),
      )
    }
    expect(doc.id_token_signing_alg_values_supported).toContain('RS256')
    expect(doc.scopes_supported).toEqual(['openid', 'profile', 'email'])
  })

  it('serves the same metadata at the RFC 8414 authorization-server path', async () => {
    const res = await get(port, '/.well-known/oauth-authorization-server')

    expect(res.status).toBe(200)
    expect((res.body as { issuer: string }).issuer).toBe(AUTH_HOST)
  })

  it('does not serve discovery under the auth base path', async () => {
    const res = await get(
      port,
      `${AUTH_PATH_SEGMENT}/.well-known/openid-configuration`,
    )

    expect(res.status).toBe(404)
  })

  it('serves a single RS256 RSA key at /jwks and persists it in the jwks table', async () => {
    const res = await get(port, `${AUTH_PATH_SEGMENT}/jwks`)

    expect(res.status).toBe(200)
    const { keys } = res.body as { keys: Array<Record<string, unknown>> }
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256' })
    expect(db.select().from(schema.jwks).all()).toHaveLength(1)
  })

  it('answers /oauth2/authorize for an unknown client with an OAuth error, not a 500', async () => {
    // A second buildAuth() on the same DB + secret signs the cookie the
    // mounted instance will accept.
    const cookie = await signInAndGetSessionCookiePair(
      buildAuth(db, { resolveVerifyService: () => undefined }),
      AUTH_HOST,
      { sub: 'google-sub-oidc', email: 'oidc@example.com' },
    )
    const query = new URLSearchParams({
      client_id: 'nope',
      redirect_uri: 'https://client.example/cb',
      response_type: 'code',
      scope: 'openid',
      state: 'xyz',
    })

    const res = await get(
      port,
      `${AUTH_PATH_SEGMENT}/oauth2/authorize?${query.toString()}`,
      { cookie },
    )

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(500)
  })
})
