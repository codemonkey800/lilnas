import http from 'node:http'

import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { UnhandledRequestStrategy } from 'msw'
import { http as mswHttp, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { AuthModule } from 'src/auth/auth.module'
import {
  isCurrentUserGuildMember,
  isGuildMember,
  lookupGuildMembership,
  type MemberLookupResult,
} from 'src/auth/guild-gate'
import { DB } from 'src/db/database.module'
import { account, session, user } from 'src/db/schema'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'

// Same test-env scoping convention as auth-mount.spec.ts (U2) — these values
// are obviously-fake test values, never real secrets, scoped to this file
// only (not the shared src/__tests__/setup.ts, since no other spec touches
// Better Auth).
process.env.BETTER_AUTH_URL = 'https://tdr-code.lilnas.io'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.DISCORD_CLIENT_ID = 'test-discord-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret'
// setup.ts already sets DISCORD_GUILD_ID = 'test-guild-id' (shared fixture).

const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? 'test-guild-id'

// msw's HTTP interceptor patches Node's http.ClientRequest globally — it
// does not scope itself to the mocked host by default. The integration
// suite below drives its OWN local NestJS test server over a real loopback
// socket (the same http.request helper auth-mount.spec.ts (U2) uses) WHILE
// also needing msw to intercept discord.com calls the real Better Auth code
// path makes — both go through the same patched http.ClientRequest, so a
// bare 'error'/'warn' strategy (which applies uniformly to every
// intercepted request, local or remote) either throws on every local
// request too (confirmed empirically: 'error' threw "Cannot bypass a
// request" on 127.0.0.1 traffic to this test's own server) or silently
// masks a genuinely-unhandled discord.com call as a mere warning. This
// scoped function strategy only errors on unhandled discord.com requests
// (a real gap in test setup) and returns without calling warning()/error()
// for everything else — onUnhandledRequest's own source confirms that's
// exactly what makes the interceptor bypass (real network passthrough) —
// which is the correct behavior for this test's own loopback traffic.
const discordOnlyUnhandledRequestStrategy: UnhandledRequestStrategy = (
  request,
  print,
) => {
  if (new URL(request.url).hostname === 'discord.com') {
    print.error()
  }
}

// Mirrors auth-mount.spec.ts's makeTestDatabaseModule — AuthModule's
// forRootAsync({ inject: [DB], ... }) factory resolves DB from this module
// without needing the real DatabaseModule (which opens a real file).
function makeTestDatabaseModule(db: TestDb['db']) {
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

// Same minimal http.request wrapper as auth-mount.spec.ts (no supertest
// dependency in this workspace).
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

// Discord's raw token-endpoint response shape (getOAuth2Tokens in
// @better-auth/core's oauth2/utils.mjs maps these snake_case fields).
function discordTokenResponse(accessToken: string) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 604800,
    refresh_token: `refresh-${accessToken}`,
    scope: 'identify email guilds.members.read',
  }
}

// Discord's raw /users/@me profile shape (better-auth/core's discord.mjs
// getUserInfo reads id/username/global_name/email/verified/avatar/
// discriminator directly off this object).
//
// `email` is REQUIRED, not optional-with-a-`??`-default: an earlier version
// made it `email?: string | null` defaulted via `opts.email ??
// 'user-...@example.com'`, which silently broke the null-email test
// scenario — `opts.email ?? fallback` treats an explicitly passed `null`
// exactly the same as "the caller didn't specify one" and substitutes the
// non-null fallback either way, so a test passing `email: null` (to
// exercise auth.ts's mapProfileToUser synthesis) never actually sent a
// null email to the mocked profile endpoint. Requiring every call site to
// state its intent (a real address, or `null`) removes the ambiguity.
function discordProfileResponse(opts: { id: string; email: string | null }) {
  return {
    id: opts.id,
    username: `user-${opts.id}`,
    global_name: `Test User ${opts.id}`,
    email: opts.email,
    verified: true,
    avatar: null,
    discriminator: '0',
  }
}

describe('Guild-membership gate (U3) — isGuildMember pure predicate', () => {
  // Scenario 6: exhaustive coverage of every MemberLookupResult variant, no
  // HTTP involved — this is what makes isGuildMember itself trivially
  // exhaustively covered independent of the integration suite below.
  it.each<[string, MemberLookupResult, boolean]>([
    ['200 member', { ok: true, status: 200 }, true],
    ['404 not found', { ok: false, status: 404 }, false],
    ['403 forbidden', { ok: false, status: 403 }, false],
    ['500 server error', { ok: false, status: 500 }, false],
    ['network error', { ok: false, status: 'network_error' }, false],
    ['malformed body', { ok: false, status: 'malformed_body' }, false],
  ])('%s -> isGuildMember() = %s', (_label, result, expected) => {
    expect(isGuildMember(result)).toBe(expected)
  })
})

describe('Guild-membership gate (U3) — lookupGuildMembership HTTP call', () => {
  const server = setupServer()

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  const guildMemberUrl = `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`

  it('200 with a valid JSON object body -> ok member result', async () => {
    server.use(
      mswHttp.get(guildMemberUrl, ({ request: req }) => {
        expect(req.headers.get('authorization')).toBe('Bearer real-token')
        return HttpResponse.json({ user: { id: '123' } }, { status: 200 })
      }),
    )

    const result = await lookupGuildMembership('real-token')
    expect(result).toEqual({ ok: true, status: 200 })
    expect(isGuildMember(result)).toBe(true)
  })

  it('404 (not a member) -> not-a-member result, fail-closed', async () => {
    server.use(
      mswHttp.get(guildMemberUrl, () =>
        HttpResponse.json({ message: 'Unknown Member' }, { status: 404 }),
      ),
    )

    const result = await lookupGuildMembership('real-token')
    expect(result).toEqual({ ok: false, status: 404 })
    expect(isGuildMember(result)).toBe(false)
  })

  it('403 (missing scope / forbidden) -> not-a-member result, fail-closed', async () => {
    server.use(
      mswHttp.get(guildMemberUrl, () =>
        HttpResponse.json({ message: 'Missing Access' }, { status: 403 }),
      ),
    )

    const result = await lookupGuildMembership('real-token')
    expect(result).toEqual({ ok: false, status: 403 })
    expect(isGuildMember(result)).toBe(false)
  })

  it('500 from Discord -> not-a-member result, fail-closed (never allow on ambiguity)', async () => {
    server.use(
      mswHttp.get(guildMemberUrl, () =>
        HttpResponse.json(
          { message: 'Internal Server Error' },
          { status: 500 },
        ),
      ),
    )

    const result = await lookupGuildMembership('real-token')
    expect(result).toEqual({ ok: false, status: 500 })
    expect(isGuildMember(result)).toBe(false)
  })

  it('a network error (Discord unreachable) -> not-a-member result, fail-closed', async () => {
    server.use(mswHttp.get(guildMemberUrl, () => HttpResponse.error()))

    const result = await lookupGuildMembership('real-token')
    expect(result).toEqual({ ok: false, status: 'network_error' })
    expect(isGuildMember(result)).toBe(false)
  })

  it('a malformed (non-JSON) 200 body -> not-a-member result, fail-closed', async () => {
    server.use(
      mswHttp.get(
        guildMemberUrl,
        () =>
          new HttpResponse('not valid json{{{', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    const result = await lookupGuildMembership('real-token')
    expect(result).toEqual({ ok: false, status: 'malformed_body' })
    expect(isGuildMember(result)).toBe(false)
  })

  it('isCurrentUserGuildMember composes lookupGuildMembership + isGuildMember end-to-end', async () => {
    server.use(
      mswHttp.get(guildMemberUrl, () =>
        HttpResponse.json({ user: { id: '123' } }, { status: 200 }),
      ),
    )
    await expect(isCurrentUserGuildMember('real-token')).resolves.toBe(true)
  })
})

describe('Guild-membership gate (U3) — real OAuth callback, Discord HTTP mocked', () => {
  // Deliberately NOT typed as @nestjs/common's INestApplication — see
  // auth-mount.spec.ts's identical comment for why (a cross-package nominal
  // type mismatch from @nestjs/testing resolving to a different copy of
  // @nestjs/common than this app depends on directly).
  let app: { close: () => Promise<void> }
  let port: number
  let testDb: TestDb
  const mswServer = setupServer()

  beforeAll(async () => {
    mswServer.listen({
      onUnhandledRequest: discordOnlyUnhandledRequestStrategy,
    })

    testDb = createTestDb()
    const TestDatabaseModule = makeTestDatabaseModule(testDb.db)

    @Module({ imports: [TestDatabaseModule, AuthModule] })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile()

    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    await nestApp.init()
    await nestApp.listen(0, '127.0.0.1')

    const address = nestApp.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }
    port = address.port
    app = nestApp
  })

  afterEach(() => {
    mswServer.resetHandlers()
    // Clean provisioned rows between tests so each test's row-count
    // assertions are against a known-empty baseline, without paying for a
    // fresh in-memory DB (+ migration run) per test.
    testDb.db.delete(session).run()
    testDb.db.delete(account).run()
    testDb.db.delete(user).run()
  })

  afterAll(async () => {
    await app.close()
    mswServer.close()
    testDb.close()
  })

  // Real OAuth round-trip state: calls the mounted sign-in/social route
  // (does NOT contact Discord — it only builds the authorize URL) and
  // captures BOTH things a real browser would carry into the callback:
  // (1) `state` from the returned URL's query string, and (2) the raw
  // `Set-Cookie` header(s) from this same response.
  //
  // (2) is load-bearing and easy to miss: better-auth/dist/state.mjs's
  // parseGenericState — even under the DEFAULT `database` storeStateStrategy
  // (which is what U2 configured, per its own comment "Keep the default
  // `database` state strategy") — ALSO requires a SIGNED "state" cookie
  // (createAuthCookie('state', ...) at state.mjs:57-58, set via
  // c.setSignedCookie) to be present and matching, on top of the
  // `verification` table row (line 105: findVerificationValue(state)).
  // This is a second, cookie-bound layer of CSRF defense the `database`
  // strategy does not remove (only the STATE PAYLOAD's storage location —
  // DB vs. an encrypted cookie — changes; the separate signed "state"
  // cookie binding stays either way, confirmed by reading parseGenericState
  // in full: the `else` branch for the database strategy at line 104-125
  // still checks `stateCookieValue !== state` at line 118 and throws
  // "State not persisted correctly" (code: state_security_mismatch) if
  // that signed cookie is absent or wrong). A test that extracts `state`
  // from the URL but never forwards this cookie fails with exactly that
  // error — not a guild-gate rejection — for every "member" scenario, which
  // is exactly what happened here before this cookie-forwarding fix.
  async function getRealOAuthState(): Promise<{
    state: string
    cookieHeader: string
  }> {
    const res = await request(port, {
      method: 'POST',
      path: '/auth/sign-in/social',
      headers: {
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ provider: 'discord' }),
    })
    expect(res.status).toBe(200)
    const body = res.body as { url: string }
    const url = new URL(body.url)
    const state = url.searchParams.get('state')
    if (!state) throw new Error('sign-in/social did not return a state param')

    const setCookieHeaders = res.headers['set-cookie']
    if (!setCookieHeaders || setCookieHeaders.length === 0) {
      throw new Error(
        'sign-in/social did not set the signed state cookie better-auth requires on callback',
      )
    }
    // Each Set-Cookie entry is "name=value; attr1; attr2..." — only the
    // "name=value" segment (before the first ';') is valid in a request
    // Cookie header; forwarding the full Set-Cookie text (Path=/;
    // HttpOnly, ...) would be malformed and Express would fail to parse it.
    const cookieHeader = setCookieHeaders
      .map(entry => entry.split(';')[0])
      .join('; ')

    return { state, cookieHeader }
  }

  function mockDiscordOAuthChain(opts: {
    accessToken: string
    discordUserId: string
    email?: string | null
    guildMemberStatus: number
  }) {
    // Distinguishes "the caller omitted `email` -> use a real-looking
    // default" from "the caller explicitly passed `email: null` -> the
    // profile response must carry a real null, not a substituted default"
    // — the same ambiguity discordProfileResponse's own comment documents,
    // resolved here via `in` (an `opts.email ?? default` here would
    // reintroduce the exact bug: it can't tell an explicit `null` apart
    // from an omitted key).
    const email: string | null =
      'email' in opts
        ? (opts.email as string | null)
        : `user-${opts.discordUserId}@example.com`

    mswServer.use(
      mswHttp.post('https://discord.com/api/oauth2/token', () =>
        HttpResponse.json(discordTokenResponse(opts.accessToken)),
      ),
      // NOTE the '%40me', not '@me': Better Auth's own Discord provider
      // fetches this profile through @better-fetch/fetch's betterFetch()
      // (confirmed by reading @better-auth/core's social-providers/
      // discord.mjs, which imports betterFetch from '@better-fetch/fetch'
      // and calls it with the literal string
      // "https://discord.com/api/users/@me"), and betterFetch's own URL-
      // building genuinely percent-encodes the leading '@' to '%40' before
      // the request ever leaves the process — verified empirically by
      // registering an msw handler on the literal '@me' path and observing
      // msw's own "unhandled request" log report the wire-level URL as
      // '.../users/%40me' instead. This does NOT apply to the
      // guild-membership URL below: guild-gate.ts calls plain global
      // fetch() directly (confirmed by reading that file), and plain
      // fetch() does not re-encode an already-valid '@' path segment
      // (verified the same way, with a plain fetch() smoke test) — so only
      // this ONE handler needs the encoded form.
      mswHttp.get('https://discord.com/api/users/%40me', ({ request: req }) => {
        expect(req.headers.get('authorization')).toBe(
          `Bearer ${opts.accessToken}`,
        )
        return HttpResponse.json(
          discordProfileResponse({ id: opts.discordUserId, email }),
        )
      }),
      mswHttp.get(
        `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
        ({ request: req }) => {
          expect(req.headers.get('authorization')).toBe(
            `Bearer ${opts.accessToken}`,
          )
          return HttpResponse.json(
            opts.guildMemberStatus === 200
              ? { user: { id: opts.discordUserId } }
              : {},
            { status: opts.guildMemberStatus },
          )
        },
      ),
    )
  }

  async function driveCallback(oauthState: {
    state: string
    cookieHeader: string
  }) {
    return request(port, {
      method: 'GET',
      path: `/auth/callback/discord?code=fake-oauth-code&state=${encodeURIComponent(oauthState.state)}`,
      // Forwarding this cookie is what makes the request a genuine
      // continuation of the SAME sign-in/social call's flow, matching a
      // real browser round-trip — see getRealOAuthState's comment for why
      // this is required even under the `database` storeStateStrategy.
      headers: { origin: ALLOWED_ORIGIN, cookie: oauthState.cookieHeader },
    })
  }

  // The callback ALWAYS sends a Set-Cookie expiring the "state" cookie on
  // every path (better-auth/dist/state.mjs's parseGenericState calls
  // expireCookie(c, stateCookie) unconditionally right after a successful
  // parse — success or reject, that expiry fires either way) — confirmed
  // empirically: a rejected sign-in's response carried
  // `__Secure-better-auth.state=; Max-Age=0; ...` and NOTHING else. A bare
  // "is set-cookie present at all" check is therefore not evidence of a
  // real session; only the ACTUAL session cookie
  // (createAuthCookie('session_token', ...) in cookies/index.mjs, name
  // `${cookiePrefix}.session_token` i.e. `better-auth.session_token`,
  // `__Secure-`-prefixed here since baseURL is https://) is.
  function hasSessionCookie(res: JsonResponse): boolean {
    const cookies = res.headers['set-cookie']
    if (!cookies) return false
    return cookies.some(entry => /\bsession_token=/.test(entry))
  }

  // Extracts the `Location` header off a redirect response — this is where
  // better-auth/dist/oauth2/errors.mjs's redirectOnError puts the
  // `?error=<code>` (and `&error_description=...`) query params (it throws
  // `ctx.redirect(...)`, which sets a real HTTP redirect `Location` header,
  // not a body). Node lower-cases incoming header names, so this reads
  // `res.headers.location`, not `Location`.
  function redirectLocation(res: JsonResponse): string {
    const location = res.headers.location
    if (typeof location !== 'string') {
      throw new Error(
        `expected a Location header on a redirect response, got status ${res.status} with no Location header`,
      )
    }
    return location
  }

  // Scenario 1 (AE5 happy path): a guild member completes OAuth ->
  // user+account+session provisioned, session cookie set.
  it('a guild member completing OAuth is provisioned with user + account + session, and gets a session cookie', async () => {
    mockDiscordOAuthChain({
      accessToken: 'member-access-token',
      discordUserId: '100000000000000001',
      guildMemberStatus: 200,
    })

    const oauthState = await getRealOAuthState()
    const res = await driveCallback(oauthState)

    // callbackOAuth always redirects on success (throw c.redirect(...)) —
    // never a raw 200 — so a redirect status is itself evidence the
    // provisioning branch (not the reject branch) ran.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(hasSessionCookie(res)).toBe(true)

    const users = testDb.db.select().from(user).all()
    const accounts = testDb.db.select().from(account).all()
    const sessions = testDb.db.select().from(session).all()
    expect(users).toHaveLength(1)
    expect(accounts).toHaveLength(1)
    expect(sessions).toHaveLength(1)
    expect(accounts[0]?.accountId).toBe('100000000000000001')
    expect(accounts[0]?.providerId).toBe('discord')

    // Token-persistence TODO resolution: the member's own account row still
    // has its accessToken/refreshToken nulled out (data minimization —
    // R18 needed the token only for the guild check that already ran).
    expect(accounts[0]?.accessToken).toBeNull()
    expect(accounts[0]?.refreshToken).toBeNull()
  })

  // Scenario 2 (AE5 error path): a non-member completes OAuth -> rejected,
  // no account row and no session row, no session cookie. Under Option B,
  // the accountless user row is swept, so this also asserts zero user rows.
  it('a non-member completing OAuth is rejected with no account, no session, no cookie, and the accountless user row is swept', async () => {
    mockDiscordOAuthChain({
      accessToken: 'nonmember-access-token',
      discordUserId: '100000000000000002',
      guildMemberStatus: 404,
    })

    const oauthState = await getRealOAuthState()
    const res = await driveCallback(oauthState)

    // A rejected sign-in still redirects (redirectOnError -> c.redirect to
    // the error URL) but carries no session cookie. Asserting the status
    // code here (not just "no cookie") is exactly what this bug's own fix
    // needs covered: before the fix, this scenario's guild-gate hook
    // returned `false`, which let the request crash with an uncaught
    // SQLITE_CONSTRAINT_FOREIGNKEY 500 instead of ever reaching this
    // redirect — a plain "no session cookie" assertion still passes on a
    // 500 response (a 500 carries no session cookie either), which is
    // exactly how this bug went unnoticed by this suite for as long as it
    // did.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(hasSessionCookie(res)).toBe(false)

    // The redirect target must carry the stable `not_guild_member` error
    // code the login page (src/app/login/page.tsx's LoginErrorCode) reads
    // off `?error=` — proving the rejection reaches Better Auth's own
    // redirectOnError with the exact message auth.ts's hook throws, not
    // just "some redirect happened."
    expect(redirectLocation(res)).toContain('error=not_guild_member')

    expect(testDb.db.select().from(account).all()).toHaveLength(0)
    expect(testDb.db.select().from(session).all()).toHaveLength(0)
    // Option B's accountless `user` row is swept by sweepAccountlessUsers()
    // inside the same hook that rejected the account insert — AE5's "no
    // usable rows" holds at the row-count level too, not just "no session."
    expect(testDb.db.select().from(user).all()).toHaveLength(0)
  })

  // Scenario 3 (fail-closed): Discord's member-lookup 500s -> treated as
  // non-member, rejected, not allowed.
  it('Discord guild-membership lookup returning 500 is treated as non-member (rejected, not allowed)', async () => {
    mockDiscordOAuthChain({
      accessToken: 'discord-down-access-token',
      discordUserId: '100000000000000003',
      guildMemberStatus: 500,
    })

    const oauthState = await getRealOAuthState()
    const res = await driveCallback(oauthState)

    // A Discord 500 during the guild check resolves to a normal `{ ok:
    // false, status: 500 }` MemberLookupResult (lookupGuildMembership
    // itself never throws on a non-200 — it only ever returns a
    // discriminated-union result), so this reaches auth.ts's hook via the
    // SAME `isMember = false` path Scenario 2 exercises, not the
    // gate-internal-throw catch branch — meaning it must produce the
    // identical redirect shape and error code as Scenario 2, not a
    // different one.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(hasSessionCookie(res)).toBe(false)
    expect(redirectLocation(res)).toContain('error=not_guild_member')
    expect(testDb.db.select().from(account).all()).toHaveLength(0)
    expect(testDb.db.select().from(session).all()).toHaveLength(0)
    expect(testDb.db.select().from(user).all()).toHaveLength(0)
  })

  // Scenario 3b (fail-closed, network-level): Discord's member-lookup
  // endpoint is entirely unreachable (not just a 5xx) -> still rejected.
  // isGuildMember's own unit tests already cover this at the predicate
  // level; this proves the SAME outcome end-to-end through the real
  // callback route, closing the gap between "the predicate says no" and
  // "the route actually enforces no."
  it('Discord guild-membership lookup timing out / unreachable is treated as non-member end-to-end', async () => {
    mswServer.use(
      mswHttp.post('https://discord.com/api/oauth2/token', () =>
        HttpResponse.json(discordTokenResponse('unreachable-access-token')),
      ),
      // '%40me', not '@me' — see mockDiscordOAuthChain's comment on the
      // exact same handler for why.
      mswHttp.get('https://discord.com/api/users/%40me', () =>
        HttpResponse.json(
          discordProfileResponse({
            id: '100000000000000006',
            email: 'user-100000000000000006@example.com',
          }),
        ),
      ),
      mswHttp.get(
        `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
        () => HttpResponse.error(),
      ),
    )

    const oauthState = await getRealOAuthState()
    const res = await driveCallback(oauthState)

    // A network-level failure (fetch() itself rejecting) is caught inside
    // lookupGuildMembership's own try/catch and folded into `{ ok: false,
    // status: 'network_error' }` — never propagated as a throw — so, same
    // as Scenario 3, this also reaches auth.ts's hook via `isMember =
    // false`, not the gate-internal-throw catch branch, and must produce
    // the identical redirect + error code.
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(hasSessionCookie(res)).toBe(false)
    expect(redirectLocation(res)).toContain('error=not_guild_member')
    expect(testDb.db.select().from(account).all()).toHaveLength(0)
    expect(testDb.db.select().from(session).all()).toHaveLength(0)
    expect(testDb.db.select().from(user).all()).toHaveLength(0)
  })

  // Scenario 4: Discord returns a null email in the profile ->
  // mapProfileToUser (U2) synthesizes one; the member is still allowed
  // through. Exercises U2's mapProfileToUser and U3's guild gate composing
  // correctly in the same real request, not the gate in isolation.
  it('a guild member with no Discord email still signs in (mapProfileToUser synthesizes one) and the guild gate still allows them', async () => {
    mockDiscordOAuthChain({
      accessToken: 'null-email-access-token',
      discordUserId: '100000000000000004',
      email: null,
      guildMemberStatus: 200,
    })

    const oauthState = await getRealOAuthState()
    const res = await driveCallback(oauthState)

    expect(hasSessionCookie(res)).toBe(true)
    const users = testDb.db.select().from(user).all()
    expect(users).toHaveLength(1)
    // mapProfileToUser's synthesized address (auth.ts) — proves the two
    // units actually compose in one request, not just independently.
    expect(users[0]?.email).toBe(
      'discord-100000000000000004@users.noreply.tdr-code.invalid',
    )
    expect(users[0]?.emailVerified).toBe(false)
    expect(testDb.db.select().from(account).all()).toHaveLength(1)
    expect(testDb.db.select().from(session).all()).toHaveLength(1)
  })

  // Scenario 5 (the atomicity test that matters most — non-vacuous per the
  // atomicity-tests-must-reach-the-write-phase learning): seed a VALID
  // member (every guard passes — the guild check itself returns 200,
  // "member"), then inject a fault AFTER the `user` row has already been
  // inserted but BEFORE the `account`/`session` rows complete. This is the
  // opposite of the vacuous "seed a non-member, assert zero rows" version —
  // that version would pass even with isCurrentUserGuildMember() literally
  // deleted from auth.ts, since the guild-gate check (which the vacuous
  // version never exercises) is what the whole unit exists to test. Here,
  // the fault fires INSIDE the write phase itself.
  //
  // The seam: isCurrentUserGuildMember is imported into auth.ts as a named
  // import (`import { isCurrentUserGuildMember } from './guild-gate'`), and
  // jest.config.js's preset is ts-jest (CommonJS output for every .ts file
  // in this app, confirmed by reading jest.config.js directly) — so per the
  // atomicity learning's own caveat, a jest.spyOn on the guild-gate module's
  // exported binding DOES intercept the call auth.ts makes (CommonJS named
  // imports compile to a namespace property read at the call site, not a
  // bound local constant the way native ESM does) — this was the deciding
  // factor for using this fault-injection technique here rather than a
  // natural DB constraint (no unique/check constraint fires between the
  // user and account inserts in this schema, so a real-constraint approach
  // isn't available the way it was for the swole doc's example).
  it('atomicity: a fault injected after the guild check passes (mid-provisioning) leaves no partial/orphan rows', async () => {
    mockDiscordOAuthChain({
      accessToken: 'atomicity-access-token',
      discordUserId: '100000000000000005',
      guildMemberStatus: 200,
    })

    const guildGateModule = await import('src/auth/guild-gate')
    const realIsCurrentUserGuildMember =
      guildGateModule.isCurrentUserGuildMember
    const spy = jest
      .spyOn(guildGateModule, 'isCurrentUserGuildMember')
      .mockImplementationOnce(async accessToken => {
        // Run the REAL guild check first — this is what proves the seeded
        // state genuinely passes the guild-membership guard (a real 200
        // from the mocked Discord endpoint), reaching the write phase for
        // real, not skipping straight to the injected failure.
        const memberResult = await realIsCurrentUserGuildMember(accessToken)
        expect(memberResult).toBe(true)
        // NOW inject the fault — after the guard passed (so the caller
        // believes this is an allowed sign-in) but the throw happens
        // synchronously inside databaseHooks.account.create.before, i.e.
        // strictly BEFORE with-hooks.mjs's createWithHooks(..., "account",
        // ...) can insert the account row — while internal-adapter.mjs's
        // createOAuthUser has ALREADY run createWithHooks(..., "user", ...)
        // for this same call (that INSERT is what makes this genuinely
        // mid-provisioning, not pre-write).
        throw new Error('injected mid-provisioning failure')
      })

    try {
      const oauthState = await getRealOAuthState()
      const res = await driveCallback(oauthState)

      // auth.ts's hook wraps isCurrentUserGuildMember in its OWN try/catch
      // (a deliberate defense-in-depth choice made specifically because of
      // this failure mode — see that hook's comment) — so the injected
      // `Error('injected mid-provisioning failure')` is caught internally
      // (setting isMember = false), and execution falls through to the SAME
      // reject-and-sweep-and-throw-APIError code a normal "Discord said no"
      // runs (Scenario 2 above) — it never surfaces as an uncaught error or
      // a crash. This is a DIFFERENT throw than the APIError auth.ts's
      // rejection branch itself now throws (that one fires strictly AFTER
      // this injected fault has already been caught and isMember is
      // already false) — the two do not interact or get confused with each
      // other; the injected fault only decides which branch sets isMember
      // to false, not what happens once it's false.
      expect(res.status).toBeGreaterThanOrEqual(300)
      expect(res.status).toBeLessThan(400)
      expect(hasSessionCookie(res)).toBe(false)
      expect(redirectLocation(res)).toContain('error=not_guild_member')

      // The assertion that actually matters: does the `user` row inserted
      // by internal-adapter.mjs's createOAuthUser BEFORE our hook even ran
      // survive as an orphan? It must not — this is exactly what the
      // hook's try/catch exists to guarantee: EVERY non-member outcome
      // (including a gate-internal exception) reaches the same
      // sweepAccountlessUsers() call before throwing the rejection
      // APIError. If this assertion ever fails, it means a thrown mid-hook
      // fault bypassed the sweep and left a permanently orphaned `user`
      // row — exactly the "partial state survives" outcome an atomicity
      // test exists to catch.
      expect(testDb.db.select().from(user).all()).toHaveLength(0)
      expect(testDb.db.select().from(account).all()).toHaveLength(0)
      expect(testDb.db.select().from(session).all()).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
})
