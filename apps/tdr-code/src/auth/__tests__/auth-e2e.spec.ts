import http from 'node:http'

import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { UnhandledRequestStrategy } from 'msw'
import { http as mswHttp, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { PinoLogger } from 'nestjs-pino'

import { AuthGuard } from 'src/auth/auth.guard'
import { AuthModule } from 'src/auth/auth.module'
import {
  buildPath,
  PROTECTED_ROUTES,
  PUBLIC_ROUTES,
} from 'src/auth/protected-routes'
import { BotStatusController } from 'src/bot/bot-status.controller'
import type { BotStatusDto } from 'src/bot/bot-status.dto'
import { BotStatusService } from 'src/bot/bot-status.service'
import { HealthController } from 'src/bot/health.controller'
import { AuthAdminController } from 'src/console/auth-admin.controller'
import { ConfigController } from 'src/console/config.controller'
import type { ConfigResponseDto } from 'src/console/config.dto'
import { ConfigService } from 'src/console/config.service'
import { DiscordDirectoryService } from 'src/console/discord-directory.service'
import { EventsController } from 'src/console/events.controller'
import type { EventListResponseDto } from 'src/console/events.dto'
import { EventsService } from 'src/console/events.service'
import { GitIdentityController } from 'src/console/git-identity.controller'
import type { UpsertGitIdentityResponseDto } from 'src/console/git-identity.dto'
import { GitIdentityService } from 'src/console/git-identity.service'
import { LifecycleController } from 'src/console/lifecycle.controller'
import { LiveController } from 'src/console/live.controller'
import type { LiveResponseDto } from 'src/console/live.dto'
import { LiveService } from 'src/console/live.service'
import { ReconcileController } from 'src/console/reconcile.controller'
import type {
  JsonlStatusResponseDto,
  ReconcileResponseDto,
} from 'src/console/reconcile.dto'
import { ReconcileService } from 'src/console/reconcile.service'
import { SessionsController } from 'src/console/sessions.controller'
import type { SessionDetailResponseDto } from 'src/console/sessions.dto'
import { SessionsService } from 'src/console/sessions.service'
import { DB } from 'src/db/database.module'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'
import { SupervisorService } from 'src/supervisor/supervisor.service'

// ──────────────────────────────────────────────────────────────────────────────
// U5 — end-to-end auth verification harness (pre-cutover gate).
//
// PURPOSE (distinguishing this file from U3's guild-gate.spec.ts and U4's
// auth.guard.spec.ts, which this file intentionally overlaps with in
// mechanics but not in intent): those two suites each prove their OWN unit
// works in isolation — U3 proves the guild-membership seam is fail-closed;
// U4 proves the guard 401s/allows correctly and enumerates every route. This
// file is the composed-system gate the plan (U5) calls for: it re-derives
// the SAME evidence from the outside, as a single suite that stands alone as
// "is the whole app-owned auth boundary safe to cut over to," so a reviewer
// (or a future maintainer) does not have to mentally OR together two
// separate units' test files to answer that question. It deliberately
// imports the U4 canonical PROTECTED_ROUTES constant (never a second,
// hand-typed list) and the U3 real-OAuth-flow pattern (never a hand-seeded
// session row) for exactly the reasons the task brief calls out: a
// hand-typed second route list could silently drift from the guard's actual
// coverage, and a hand-seeded session row would not catch a regression in
// the OAuth flow itself.
//
// This suite still runs entirely against a real, listening NestJS HTTP
// server (never a controller-level unit call) — matching every other Phase D
// auth spec's own discipline.
// ──────────────────────────────────────────────────────────────────────────────

// Same test-env scoping convention as auth-mount.spec.ts / guild-gate.spec.ts
// / auth.guard.spec.ts (U2/U3/U4) — obviously-fake test values, scoped to
// this file only (not the shared src/__tests__/setup.ts).
process.env.BETTER_AUTH_URL = 'https://tdr-code.lilnas.io'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.DISCORD_CLIENT_ID = 'test-discord-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret'
// setup.ts already sets DISCORD_GUILD_ID = 'test-guild-id' (shared fixture).

const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? 'test-guild-id'

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

// Mirrors auth-mount.spec.ts / guild-gate.spec.ts / auth.guard.spec.ts's own
// makeTestDatabaseModule — AuthModule's forRootAsync({ inject: [DB], ... })
// factory resolves DB from this module without needing the real
// DatabaseModule (which opens a real file).
function makeTestDatabaseModule(db: TestDb['db']) {
  @Global()
  @Module({
    providers: [{ provide: DB, useValue: db }],
    exports: [DB],
  })
  class TestDatabaseModule {}
  return TestDatabaseModule
}

const MOCK_CONFIG_RESPONSE: ConfigResponseDto = {
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
}

const MOCK_GIT_IDENTITY_RESPONSE: UpsertGitIdentityResponseDto = {
  discordUserId: '123456789012345678',
  fingerprint: 'SHA256:fake-fingerprint-for-test',
  status: 'configured',
}

const MOCK_LIVE_RESPONSE: LiveResponseDto = {
  botOffline: true,
  globalStatus: 'never-seen',
  items: [],
}

const MOCK_SESSION_DETAIL: SessionDetailResponseDto = {
  session: {
    id: 999999999,
    channelId: '100000000000000001',
    triggeringUserId: '100000000000000001',
    createdAt: new Date().toISOString(),
    endedAt: null,
    endReason: null,
  },
  turns: [],
  droppedBlocks: 0,
}

const MOCK_EVENTS_RESPONSE: EventListResponseDto = {
  items: [],
  nextCursor: null,
}

const MOCK_JSONL_STATUS: JsonlStatusResponseDto = {
  acpSessionId: null,
  exists: false,
  reason: 'no-acp-id',
}

const MOCK_RECONCILE_RESPONSE: ReconcileResponseDto = {
  verdict: 'cannot-reconcile',
  reason: 'no-acp-id',
}

const MOCK_BOT_STATUS: BotStatusDto = {
  status: 'never-seen',
  lastSeenAt: null,
}

// Wires every console/bot controller (mocked *Services only — exactly the
// same shape auth.guard.spec.ts's Section 3 uses) alongside the REAL
// AuthModule and the REAL hand-rolled AuthGuard registered as APP_GUARD —
// i.e. the actual composed app.module.ts wiring, not a stand-in. This is
// what makes the sweep below a genuine "is the composed system safe" check
// rather than a re-run of one unit's own mocks.
function buildTestAppModule(db: TestDb['db']) {
  const TestDatabaseModule = makeTestDatabaseModule(db)

  const mockLiveService = {
    getLive: jest.fn().mockReturnValue(MOCK_LIVE_RESPONSE),
  }
  const mockSessionsService = {
    listSessions: jest.fn().mockReturnValue({ items: [], nextCursor: null }),
    getSessionTranscript: jest.fn().mockReturnValue(MOCK_SESSION_DETAIL),
  }
  const mockEventsService = {
    listEvents: jest.fn().mockReturnValue(MOCK_EVENTS_RESPONSE),
  }
  const mockReconcileService = {
    getJsonlStatus: jest.fn().mockReturnValue(MOCK_JSONL_STATUS),
    reconcile: jest.fn().mockReturnValue(MOCK_RECONCILE_RESPONSE),
  }
  const mockConfigService = {
    getConfig: jest.fn().mockReturnValue(MOCK_CONFIG_RESPONSE),
    updateConfig: jest.fn().mockReturnValue(MOCK_CONFIG_RESPONSE),
  }
  const mockGitIdentityService = {
    listIdentities: jest.fn().mockReturnValue([]),
    upsertIdentity: jest.fn().mockReturnValue(MOCK_GIT_IDENTITY_RESPONSE),
    deleteIdentity: jest.fn(),
  }
  const mockDiscordDirectoryService = {
    listGuildMembers: jest.fn().mockResolvedValue([]),
  }
  const mockBotStatusService = {
    getStatus: jest.fn().mockReturnValue(MOCK_BOT_STATUS),
  }
  // LifecycleController also injects DB directly for teardown's
  // latestGeneration() lookup — an empty test DB has no bot_generation row,
  // so teardown naturally 409s (ConflictException('bot-offline')), which is
  // exactly the "reached the controller, guard let it through" signal this
  // suite's authenticated sweep needs (not a functional bot-lifecycle test —
  // that belongs to lifecycle.controller.spec.ts).
  const mockSupervisorService = {
    requestRestart: jest.fn().mockReturnValue({ phase: 'Starting' }),
  }
  const fakePinoLogger = fakeLogger()

  @Module({
    imports: [TestDatabaseModule, AuthModule],
    controllers: [
      LiveController,
      LifecycleController,
      SessionsController,
      EventsController,
      ReconcileController,
      ConfigController,
      GitIdentityController,
      AuthAdminController,
      BotStatusController,
      HealthController,
    ],
    providers: [
      { provide: LiveService, useValue: mockLiveService },
      { provide: SessionsService, useValue: mockSessionsService },
      { provide: EventsService, useValue: mockEventsService },
      { provide: ReconcileService, useValue: mockReconcileService },
      { provide: ConfigService, useValue: mockConfigService },
      { provide: GitIdentityService, useValue: mockGitIdentityService },
      {
        provide: DiscordDirectoryService,
        useValue: mockDiscordDirectoryService,
      },
      { provide: BotStatusService, useValue: mockBotStatusService },
      { provide: SupervisorService, useValue: mockSupervisorService },
      { provide: PinoLogger, useValue: fakePinoLogger },
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class TestAppModule {}

  return { TestAppModule }
}

type JsonResponse = {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
  rawBody: string
}

// Same minimal http.request wrapper as every other Phase D auth spec (no
// supertest dependency in this workspace).
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

// Discord's raw responses — same shapes guild-gate.spec.ts (U3) and
// auth.guard.spec.ts (U4) already proved match the real APIs Better Auth's
// Discord provider and guild-gate.ts call.
function discordTokenResponse(accessToken: string) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 604800,
    refresh_token: `refresh-${accessToken}`,
    scope: 'identify email guilds.members.read',
  }
}

function discordProfileResponse(opts: { id: string }) {
  return {
    id: opts.id,
    username: `user-${opts.id}`,
    global_name: `Test User ${opts.id}`,
    email: `user-${opts.id}@example.com`,
    verified: true,
    avatar: null,
    discriminator: '0',
  }
}

// msw's HTTP interceptor patches Node's http.ClientRequest globally, so this
// suite's own local NestJS test server (over a real loopback socket) and the
// discord.com calls the real Better Auth code path makes both go through the
// same patched http.ClientRequest — see guild-gate.spec.ts's identical
// comment for why a bare 'error'/'warn' strategy is wrong here and this
// scoped function strategy (erroring ONLY on unhandled discord.com traffic)
// is required.
const discordOnlyUnhandledRequestStrategy: UnhandledRequestStrategy = (
  req,
  print,
) => {
  if (new URL(req.url).hostname === 'discord.com') {
    print.error()
  }
}

// The callback ALWAYS sends a Set-Cookie expiring the transient "state"
// cookie regardless of outcome (see guild-gate.spec.ts's identical comment
// for the full trace into better-auth/dist/state.mjs's parseGenericState) —
// so a bare "is set-cookie present" check is not evidence of a real session.
// Only the actual session cookie (name `${cookiePrefix}.session_token`,
// `__Secure-`-prefixed here since baseURL is https://) is.
function hasSessionCookie(res: JsonResponse): boolean {
  const cookies = res.headers['set-cookie']
  if (!cookies) return false
  return cookies.some(entry => /\bsession_token=/.test(entry))
}

describe('U5 — end-to-end auth verification harness (pre-cutover gate)', () => {
  let app: { close: () => Promise<void> }
  let port: number
  let testDb: TestDb
  const mswServer = setupServer()

  beforeAll(async () => {
    mswServer.listen({
      onUnhandledRequest: discordOnlyUnhandledRequestStrategy,
    })
    testDb = createTestDb()
    const { TestAppModule } = buildTestAppModule(testDb.db)

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile()

    // Deliberately NOT typed as @nestjs/common's INestApplication — see
    // auth-mount.spec.ts's identical comment for why (a cross-package
    // nominal type mismatch from @nestjs/testing resolving to a different
    // copy of @nestjs/common than this app depends on directly).
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
  })

  afterAll(async () => {
    await app.close()
    mswServer.close()
    testDb.close()
  })

  // Mints a genuine, correctly-signed Better Auth session cookie by driving
  // a REAL Discord OAuth round trip against the mounted /auth/* handler
  // (Discord itself mocked via msw) — reusing the EXACT U3 pattern
  // (getRealOAuthState + mockDiscordOAuthChain + driveCallback), condensed
  // into one function per this suite's own brief: "don't hand-seed a
  // session row directly into the test DB; going through the real flow is
  // what makes this gate meaningful (a hand-seeded row wouldn't catch a
  // regression in the OAuth flow itself)."
  async function mintMemberSessionCookie(opts: {
    discordUserId: string
    accessToken: string
  }): Promise<string> {
    mswServer.use(
      mswHttp.post('https://discord.com/api/oauth2/token', () =>
        HttpResponse.json(discordTokenResponse(opts.accessToken)),
      ),
      // '%40me' not '@me' — betterFetch percent-encodes the leading '@'
      // before the request leaves the process (confirmed in
      // guild-gate.spec.ts's identical comment, verified empirically there).
      mswHttp.get('https://discord.com/api/users/%40me', () =>
        HttpResponse.json(discordProfileResponse({ id: opts.discordUserId })),
      ),
      mswHttp.get(
        `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
        () =>
          HttpResponse.json(
            { user: { id: opts.discordUserId } },
            { status: 200 },
          ),
      ),
    )

    const signInRes = await request(port, {
      method: 'POST',
      path: '/auth/sign-in/social',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ provider: 'discord' }),
    })
    expect(signInRes.status).toBe(200)
    const body = signInRes.body as { url: string }
    const url = new URL(body.url)
    const state = url.searchParams.get('state')
    if (!state) throw new Error('sign-in/social did not return a state param')

    // The signed "state" cookie better-auth ALSO requires on callback, on
    // top of the `verification` table row — required even under the
    // DEFAULT `database` storeStateStrategy (see guild-gate.spec.ts's
    // getRealOAuthState for the full file:line trace of why this is
    // load-bearing and easy to miss).
    const setCookieHeaders = signInRes.headers['set-cookie']
    if (!setCookieHeaders || setCookieHeaders.length === 0) {
      throw new Error('sign-in/social did not set the signed state cookie')
    }
    const stateCookieHeader = setCookieHeaders
      .map(entry => entry.split(';')[0])
      .join('; ')

    const callbackRes = await request(port, {
      method: 'GET',
      path: `/auth/callback/discord?code=fake-oauth-code&state=${encodeURIComponent(state)}`,
      headers: { origin: ALLOWED_ORIGIN, cookie: stateCookieHeader },
    })

    if (!hasSessionCookie(callbackRes)) {
      throw new Error(
        `mintMemberSessionCookie: callback did not set a session cookie (status ${callbackRes.status})`,
      )
    }
    const sessionSetCookies = callbackRes.headers['set-cookie']
    if (!sessionSetCookies) {
      throw new Error('mintMemberSessionCookie: no set-cookie header')
    }
    return sessionSetCookies.map(entry => entry.split(';')[0]).join('; ')
  }

  // ---------------------------------------------------------------------------
  // Requirement 1: unauthenticated sweep. Every PROTECTED_ROUTES entry 401s
  // with no session cookie; GET /health stays public.
  //
  // The READ routes get their OWN explicit describe block (not folded into
  // the full it.each below) because they are, per the task brief, "the
  // single most consequential assertion in the whole gate": these routes
  // carry NO requireSameOrigin() backstop (only mutating routes do — see
  // config/git-identity/lifecycle/auth-admin controllers), so a guard hole
  // on any one of them (e.g. GET /sessions/:id/reconcile leaking raw agent
  // diff content to an anonymous caller) has nothing else in the system
  // that would catch it. If AuthGuard ever regressed to allow one of these
  // through, this describe block — not the general sweep below it — is what
  // would catch it, and its name says so explicitly in any failure report.
  // ---------------------------------------------------------------------------

  describe('1. Unauthenticated sweep — every PROTECTED_ROUTES entry 401s with no cookie', () => {
    // The reads, called out explicitly per the task brief: these have NO
    // requireSameOrigin backstop, so a hole here is caught by nothing else
    // in the system. Labels match protected-routes.ts's own `label` field
    // exactly (verified against that file, not retyped from memory) so this
    // list can never silently diverge into testing a route that doesn't
    // exist or missing one that does.
    const READ_ROUTE_LABELS = [
      'GET /live',
      'GET /sessions',
      'GET /sessions/:id',
      'GET /sessions/:id/reconcile',
      'GET /sessions/:id/jsonl-status',
      'GET /events',
      'GET /config',
      'GET /git-identity',
      'GET /git-identity/discord-members',
      'GET /bot/status',
    ]

    const readRoutes = PROTECTED_ROUTES.filter(spec =>
      READ_ROUTE_LABELS.includes(spec.label),
    )

    // Bookkeeping guard: if protected-routes.ts ever renames/removes one of
    // these labels, this suite's own read-route list would silently shrink
    // and stop testing the route it thinks it's testing. Fail loudly instead
    // of silently testing fewer routes than intended.
    it('every named read-route label above actually exists in PROTECTED_ROUTES (no silent drift)', () => {
      expect(readRoutes).toHaveLength(READ_ROUTE_LABELS.length)
    })

    it.each(readRoutes)(
      '[NO same-origin backstop] $label -> 401 with no session cookie',
      async spec => {
        const res = await request(port, {
          method: spec.method,
          path: buildPath(spec),
          headers: { origin: ALLOWED_ORIGIN },
        })
        expect(res.status).toBe(401)
      },
    )

    // The full sweep — every PROTECTED_ROUTES entry, mutating routes
    // included (those DO also carry requireSameOrigin, but the guard must
    // 401 them before that check is ever reached — a cross-origin caller
    // with no cookie should never get to find out whether same-origin would
    // also have rejected it).
    it.each(PROTECTED_ROUTES)(
      '$label -> 401 with no session cookie',
      async spec => {
        const res = await request(port, {
          method: spec.method,
          path: buildPath(spec),
          headers: { origin: ALLOWED_ORIGIN },
        })
        expect(res.status).toBe(401)
      },
    )

    // Requirement 6: /health stays public throughout this suite's own
    // setup — sanity-checked here, at the very top, before any session has
    // been minted, so a regression that accidentally guards /health is
    // caught at the earliest possible point rather than discovered later
    // through an unrelated test's unexpected failure.
    it.each(PUBLIC_ROUTES)(
      '$label -> NOT 401 with no session cookie (the sole allowlisted route)',
      async spec => {
        const res = await request(port, {
          method: spec.method,
          path: buildPath(spec),
        })
        expect(res.status).not.toBe(401)
        expect(res.status).toBe(200)
      },
    )
  })

  // ---------------------------------------------------------------------------
  // Requirement 2: authenticated member sweep. A REAL session minted via the
  // U3 OAuth-flow pattern reaches every PROTECTED_ROUTES entry (none 401 —
  // a 404/400 from a fake path param reaching real controller validation is
  // fine and expected; a 401 is not).
  // ---------------------------------------------------------------------------

  describe('2. Authenticated member sweep — a real minted session reaches every PROTECTED_ROUTES entry', () => {
    let cookieHeader: string

    beforeAll(async () => {
      cookieHeader = await mintMemberSessionCookie({
        discordUserId: '200000000000000001',
        accessToken: 'e2e-sweep-access-token',
      })
    })

    it.each(PROTECTED_ROUTES)(
      '$label -> reachable (not 401) with a real member session cookie',
      async spec => {
        const res = await request(port, {
          method: spec.method,
          path: buildPath(spec),
          headers: { origin: ALLOWED_ORIGIN, cookie: cookieHeader },
        })
        expect(res.status).not.toBe(401)
      },
    )

    it('GET /health also succeeds with a real member session cookie present', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/health',
        headers: { cookie: cookieHeader },
      })
      expect(res.status).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Requirement 3: the OAuth callback path is reachable — never blocked by
  // AuthGuard. This assertion structurally can only live here (not in U3's
  // or U4's own suite): it needs BOTH U2's mount (the /auth/* handler
  // existing at all, outside Nest's guarded pipeline) AND U3's gate (a real
  // guild-membership decision actually running) to exist simultaneously, so
  // the callback response is provably produced by the GUILD GATE or Better
  // Auth's own state/callback logic — never a 401 from AuthGuard, because
  // the guard should never even see this request (the mount sits outside
  // Nest's controller pipeline entirely, confirmed empirically back in U2).
  // ---------------------------------------------------------------------------

  describe('3. OAuth callback path reachable — never intercepted by AuthGuard', () => {
    // Shared driver for both non-member scenarios below (the currently-
    // passing "not intercepted by AuthGuard" test and the currently-failing
    // regression test documenting the U3 bug this suite discovered) so the
    // exact same OAuth round trip backs both assertions.
    async function driveNonMemberCallback(): Promise<JsonResponse> {
      const discordUserId = '200000000000000002'
      const accessToken = 'e2e-callback-nonmember-token'
      mswServer.use(
        mswHttp.post('https://discord.com/api/oauth2/token', () =>
          HttpResponse.json(discordTokenResponse(accessToken)),
        ),
        mswHttp.get('https://discord.com/api/users/%40me', () =>
          HttpResponse.json(discordProfileResponse({ id: discordUserId })),
        ),
        // 404 = not a member — the guild gate (U3), not AuthGuard, is what
        // decides this outcome; AuthGuard has no way to know the OAuth
        // callback's own guild-membership verdict at all.
        mswHttp.get(
          `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
          () => HttpResponse.json({}, { status: 404 }),
        ),
      )

      const signInRes = await request(port, {
        method: 'POST',
        path: '/auth/sign-in/social',
        headers: {
          'content-type': 'application/json',
          origin: ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ provider: 'discord' }),
      })
      expect(signInRes.status).toBe(200)
      const url = new URL((signInRes.body as { url: string }).url)
      const state = url.searchParams.get('state')
      if (!state) throw new Error('missing state param')
      const setCookieHeaders = signInRes.headers['set-cookie']
      if (!setCookieHeaders) throw new Error('missing signed state cookie')
      const stateCookieHeader = setCookieHeaders
        .map(entry => entry.split(';')[0])
        .join('; ')

      return request(port, {
        method: 'GET',
        path: `/auth/callback/discord?code=fake-oauth-code&state=${encodeURIComponent(state)}`,
        headers: { origin: ALLOWED_ORIGIN, cookie: stateCookieHeader },
      })
    }

    it('a non-member callback response is NOT a 401 from AuthGuard', async () => {
      const callbackRes = await driveNonMemberCallback()

      // The load-bearing negative assertion this suite's charter actually
      // needs: NOT 401. AuthGuard's own failure contract (auth.guard.ts)
      // throws UnauthorizedException, which NestJS's exception filter
      // renders as exactly 401 — so if this request were somehow routed
      // through the guarded pipeline instead of the Better Auth mount, a
      // rejected guild-gate outcome would look identical to "AuthGuard
      // denied it." This assertion is what proves that never happens: the
      // response here (whatever it is) is provably NOT AuthGuard's doing,
      // because AuthGuard's only failure mode is 401 and this is asserted
      // to differ from that. Kept as its OWN test (deliberately separate
      // from the AE5-contract test below) so a regression in the guild
      // gate's HTTP contract (see that test's own header comment for the
      // bug this suite found) does not mask a regression in AuthGuard's own
      // boundary, and vice versa — the two are orthogonal claims.
      expect(callbackRes.status).not.toBe(401)
    })

    // ─────────────────────────────────────────────────────────────────────
    // FORMERLY A KNOWN, REPORTED DEFECT — found by this gate, FIXED in
    // auth.ts (post-U5 follow-up fix; this comment previously pinned the
    // buggy 500 as a regression marker and has been updated to record what
    // was wrong and how it was fixed, rather than deleted outright, so a
    // future reader has the same context the original bug report had).
    //
    // Root cause, traced against the INSTALLED better-auth@1.6.23 source
    // (not assumed from docs or from auth.ts's own PRE-FIX comments, which
    // were themselves what was wrong here):
    //   - internal-adapter.mjs's createOAuthUser (node_modules/better-auth/
    //     dist/db/internal-adapter.mjs:59-77) returns `{ user: createdUser,
    //     account: await createWithHooks(..., "account", ...) }` — the
    //     ALREADY-COMMITTED `user` row is returned UNCONDITIONALLY; it did
    //     NOT become null when the account.create.before hook (this app's
    //     own auth.ts) returned `false` (with-hooks.mjs's createWithHooks:
    //     `if (result === false) return null` — that null lands on
    //     `account` only, never on the sibling `user` field).
    //   - link-account.mjs's handleOAuthUserInfo (dist/oauth2/link-
    //     account.mjs:97-104) does `user = createdUser` unconditionally and
    //     never checks whether `createdAccount` is null before proceeding
    //     to line 134's `createSession(user.id)` — an unconditional INSERT
    //     with no existence check on `userId` (confirmed directly in
    //     internal-adapter.mjs's createSession, dist/db/internal-
    //     adapter.mjs:162-188: it builds a data object and calls
    //     createWithHooks(data, "session", ...), nothing else).
    //   - auth.ts's OWN guild-gate hook (databaseHooks.account.create
    //     .before, src/auth/auth.ts) calls `sweepAccountlessUsers(db)`
    //     SYNCHRONOUSLY — deleting that EXACT `user.id` row — BEFORE
    //     (pre-fix) returning `false`. By the time createSession(user.id)
    //     ran moments later in the SAME request (back up the call stack in
    //     link-account.mjs), the row it referenced was already gone, and
    //     the session INSERT threw
    //     SqliteError{code:'SQLITE_CONSTRAINT_FOREIGNKEY'} — uncaught by
    //     link-account.mjs or callback.mjs (callback.mjs's own try/catch
    //     around handleOAuthUserInfo only special-cases isAPIError(e); a
    //     raw SqliteError is not an APIError, so dist/api/routes/
    //     callback.mjs:153-156 just re-threw it verbatim), surfacing as a
    //     raw 500 to the client.
    //
    // The fix (auth.ts's guild-gate hook, see its own header comment for
    // the full trace): the rejection branch now THROWS `new
    // APIError('FORBIDDEN', { message: 'not guild member' })` instead of
    // `return false`, after the sweep runs. handleOAuthUserInfo wraps its
    // ENTIRE createOAuthUser(...) call in a try/catch that DOES check
    // `isAPIError(e)` and returns `{ error: e.message, data: null,
    // isRegister: false }` — never reaching the later `createSession` call
    // in the same function at all (that catch sits above/wraps it), so the
    // FK-violation crash can no longer happen. callback.mjs's `if
    // (result.error) redirectOnError(...)` then produces a clean redirect
    // carrying `error=not_guild_member` (byte-identical to the login page's
    // `not_guild_member` LoginErrorCode after `.split(' ').join('_')`).
    //
    // Net effect / why U3's OWN guild-gate.spec.ts suite never caught this
    // originally: AE5's "non-member rejected, no working session" DID still
    // hold in terms of the FINAL DB state and cookies even with the bug
    // (confirmed: no account/session/user row survived — the session
    // INSERT's own failure meant it never committed either — and no
    // session cookie was set), which is exactly what guild-gate.spec.ts
    // asserted. But NONE of guild-gate.spec.ts's non-member scenarios
    // asserted the callback response's HTTP STATUS CODE at the time. So the
    // HTTP contract for this rejection — 500, not the redirect-to-
    // /login?error every OTHER non-member/error path in this app produces —
    // was invisible to that unit's own test suite despite being a real,
    // reachable defect on every non-member sign-in attempt. guild-gate.spec
    // .ts's non-member scenarios now assert status codes and the
    // `error=not_guild_member` redirect target too, closing that gap at
    // the unit level as well as here.
    // ─────────────────────────────────────────────────────────────────────
    it('a non-member callback redirects per AE5 (no session cookie), not the 500 this suite previously found and pinned', async () => {
      const callbackRes = await driveNonMemberCallback()

      // Matches the "member" callback test's own redirect-shape assertions
      // right below — a non-member rejection and a member success both
      // produce a real HTTP redirect; only the presence of a session
      // cookie (and the error= query param, asserted at the unit level in
      // guild-gate.spec.ts) distinguishes them.
      expect(callbackRes.status).toBeGreaterThanOrEqual(300)
      expect(callbackRes.status).toBeLessThan(400)
      expect(hasSessionCookie(callbackRes)).toBe(false)
    })

    it('a member callback response is produced by the guild gate allowing it through (redirect + session cookie, not a 401)', async () => {
      const discordUserId = '200000000000000003'
      const accessToken = 'e2e-callback-member-token'
      mswServer.use(
        mswHttp.post('https://discord.com/api/oauth2/token', () =>
          HttpResponse.json(discordTokenResponse(accessToken)),
        ),
        mswHttp.get('https://discord.com/api/users/%40me', () =>
          HttpResponse.json(discordProfileResponse({ id: discordUserId })),
        ),
        mswHttp.get(
          `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
          () =>
            HttpResponse.json({ user: { id: discordUserId } }, { status: 200 }),
        ),
      )

      const signInRes = await request(port, {
        method: 'POST',
        path: '/auth/sign-in/social',
        headers: {
          'content-type': 'application/json',
          origin: ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ provider: 'discord' }),
      })
      const url = new URL((signInRes.body as { url: string }).url)
      const state = url.searchParams.get('state')
      if (!state) throw new Error('missing state param')
      const setCookieHeaders = signInRes.headers['set-cookie']
      if (!setCookieHeaders) throw new Error('missing signed state cookie')
      const stateCookieHeader = setCookieHeaders
        .map(entry => entry.split(';')[0])
        .join('; ')

      const callbackRes = await request(port, {
        method: 'GET',
        path: `/auth/callback/discord?code=fake-oauth-code&state=${encodeURIComponent(state)}`,
        headers: { origin: ALLOWED_ORIGIN, cookie: stateCookieHeader },
      })

      expect(callbackRes.status).not.toBe(401)
      expect(callbackRes.status).toBeGreaterThanOrEqual(300)
      expect(callbackRes.status).toBeLessThan(400)
      expect(hasSessionCookie(callbackRes)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Requirement 4: logout clears the session. Sign in for real, confirm a
  // guarded route is reachable, call Better Auth's sign-out route with that
  // session's cookie, then confirm the SAME cookie now 401s on the very
  // next guarded request.
  //
  // Better Auth's actual sign-out behavior (verified against the installed
  // 1.6.23 source at
  // better-auth/dist/api/routes/sign-out.mjs, not assumed from docs — see
  // this unit's final report for the full citation): the handler does BOTH
  // of the two things "logout clears the session" could mean, not just one:
  //   1. `ctx.context.internalAdapter.deleteSession(sessionCookieToken)` —
  //      an actual DB DELETE of the `session` row keyed by the token read
  //      from the signed session cookie (wrapped in its own try/catch that
  //      only logs on failure — it does not abort the sign-out on a DB
  //      error).
  //   2. `deleteSessionCookie(ctx)` — expires the session_token (and
  //      sessionData/accountData) cookies client-side via expireCookie.
  // So this is genuinely server-side session invalidation, not merely a
  // client-side cookie clear the browser could ignore or a stale copy of
  // which could still authenticate elsewhere — the DB row itself is gone,
  // which is what makes "the SAME cookie 401s afterward" a meaningful
  // assertion about server state, not just "the browser forgot the cookie."
  // ---------------------------------------------------------------------------

  describe('4. Logout clears the session — the SAME cookie 401s afterward', () => {
    it('sign in -> guarded route reachable -> sign-out -> the SAME cookie now 401s', async () => {
      const cookieHeader = await mintMemberSessionCookie({
        discordUserId: '200000000000000004',
        accessToken: 'e2e-logout-access-token',
      })

      // Confirm the session is genuinely live before logging out — this is
      // what makes "401 afterward" evidence of logout actually doing
      // something, rather than the cookie having never worked at all.
      const beforeRes = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: cookieHeader },
      })
      expect(beforeRes.status).not.toBe(401)

      // Better Auth's mounted sign-out route — internal path per U2's
      // basePath split (this suite drives the mount directly on the /auth
      // internal prefix, exactly like every other Phase D auth spec's own
      // requests to /auth/sign-in/social and /auth/callback/discord; the
      // public /api/auth/sign-out path is only what the BROWSER calls
      // through Next's rewrite, which strips /api before NestJS ever sees
      // it — see auth.ts's header comment for the full public/internal
      // path-split rationale).
      const signOutRes = await request(port, {
        method: 'POST',
        path: '/auth/sign-out',
        headers: { origin: ALLOWED_ORIGIN, cookie: cookieHeader },
      })
      expect(signOutRes.status).toBe(200)

      const afterRes = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: cookieHeader },
      })
      expect(afterRes.status).toBe(401)
    })
  })

  // ---------------------------------------------------------------------------
  // Requirement 5: tampered/expired cookie -> 401, not 500, across the
  // board — matching the unauthenticated sweep's own thoroughness (every
  // PROTECTED_ROUTES entry, not a representative sample), because this is
  // the "getSession must never accidentally allow, and must never 500"
  // contract U4 built, verified here from the OUTSIDE as observed system
  // behavior across the composed app, not by re-reading auth.guard.ts's own
  // source (which is what U4's own auth.guard.spec.ts already does).
  // ---------------------------------------------------------------------------

  describe('5. Tampered/expired cookie -> 401 (never 500) across every PROTECTED_ROUTES entry', () => {
    // A syntactically-plausible-but-invalid session token: matches Better
    // Auth's own cookie-name convention (`__Secure-better-auth.session_
    // token=<value>`) so it reaches getSession's real cookie-parsing logic,
    // but corresponds to no real row and carries no valid HMAC signature —
    // exactly the "not matching any real row" shape the task brief asks
    // for, built without ever having minted a real session at all (this
    // describe block does not call mintMemberSessionCookie).
    const TAMPERED_COOKIE =
      '__Secure-better-auth.session_token=not-a-real-signed-session-token-value.tampered-signature-segment'

    it.each(PROTECTED_ROUTES)(
      '$label -> 401 (not 500) with a syntactically-plausible but invalid session cookie',
      async spec => {
        const res = await request(port, {
          method: spec.method,
          path: buildPath(spec),
          headers: { origin: ALLOWED_ORIGIN, cookie: TAMPERED_COOKIE },
        })
        expect(res.status).toBe(401)
        expect(res.status).not.toBe(500)
      },
    )

    // A genuinely-real session that has since expired — the OTHER distinct
    // getSession code path (a found, correctly-signed session row whose
    // expiresAt has passed), not just a bad-signature cookie. Covered as
    // its own targeted case (not folded into the it.each above, which needs
    // a single reusable cookie value known upfront) because it exercises a
    // different branch inside getSession than a bad-signature/unknown token
    // does — see auth.guard.ts's own header comment on getSession's failure
    // contract for the two distinct null-returning paths.
    it('a genuinely expired (but correctly-signed) session row -> 401 (not 500) on a representative guarded route', async () => {
      const cookieHeader = await mintMemberSessionCookie({
        discordUserId: '200000000000000005',
        accessToken: 'e2e-expired-access-token',
      })

      // Age out the underlying session row directly — the cookie's own
      // signature stays valid (untouched); only the DB-side expiresAt
      // changes, so getSession's own `session.session.expiresAt < new
      // Date()` check is what must reject it, not a signature failure.
      const { session } = await import('src/db/schema')
      testDb.db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .run()

      const res = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: cookieHeader },
      })
      expect(res.status).toBe(401)
      expect(res.status).not.toBe(500)
    })
  })

  // ---------------------------------------------------------------------------
  // Requirement 6 (continued): /health stays public even after this suite
  // has minted real sessions, signed them out, and exercised tampered
  // cookies — confirming nothing in this suite's OWN setup (or the app's
  // composed wiring under test) accidentally regresses the one allowlisted
  // route. Placed at the end, after every other scenario has run, so this
  // is a genuine end-of-suite sanity check rather than a duplicate of the
  // top-of-suite check in section 1.
  // ---------------------------------------------------------------------------

  describe('6. /health stays public throughout (end-of-suite confirmation)', () => {
    it('GET /health returns 200 with no cookie, after every other scenario in this suite has run', async () => {
      const res = await request(port, { method: 'GET', path: '/health' })
      expect(res.status).toBe(200)
    })

    it('GET /health returns 200 even carrying a tampered cookie (never guarded)', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/health',
        headers: {
          cookie:
            '__Secure-better-auth.session_token=garbage-value-should-be-ignored',
        },
      })
      expect(res.status).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Final bookkeeping: re-derive the route count directly from the
  // canonical constant this whole suite imports, so a future PROTECTED_
  // ROUTES edit that silently changes the count is caught here too (U4's
  // own auth.guard.spec.ts already asserts this identical invariant against
  // the same constant — intentionally duplicated, not merged, because this
  // suite must stand alone as the composed-system gate per its own charter
  // above; a reader should not have to cross-reference U4's file to know
  // this suite's sweep covered the exact right number of routes).
  // ---------------------------------------------------------------------------

  describe('bookkeeping — this suite swept exactly as many routes as PROTECTED_ROUTES declares', () => {
    it('PROTECTED_ROUTES has exactly 16 entries (the canonical U4 enumeration this suite imports, not a second hand-typed list)', () => {
      expect(PROTECTED_ROUTES).toHaveLength(16)
    })

    it('PUBLIC_ROUTES has exactly one entry: GET /health', () => {
      expect(PUBLIC_ROUTES).toHaveLength(1)
      expect(PUBLIC_ROUTES[0]).toMatchObject({
        method: 'GET',
        path: '/health',
      })
    })
  })
})
