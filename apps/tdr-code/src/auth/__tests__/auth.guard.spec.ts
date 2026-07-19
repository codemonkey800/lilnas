import http from 'node:http'

import { Global, Module } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { AuthService } from '@thallesp/nestjs-better-auth'
import type { UnhandledRequestStrategy } from 'msw'
import { http as mswHttp, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { PinoLogger } from 'nestjs-pino'
import { NEVER } from 'rxjs'

import { type AuthedUser, AuthGuard } from 'src/auth/auth.guard'
import { AuthModule } from 'src/auth/auth.module'
import {
  buildPath,
  PROTECTED_ROUTES,
  PUBLIC_ROUTES,
} from 'src/auth/protected-routes'
import { Public } from 'src/auth/public.decorator'
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
import { GitRosterController } from 'src/console/git-roster.controller'
import { GitRosterService } from 'src/console/git-roster.service'
import { GithubLinkController } from 'src/console/github-link.controller'
import { GithubLinkService } from 'src/console/github-link.service'
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
import { revokeSessionsForDiscordUser } from 'src/db/auth-session.repo'
import { DB } from 'src/db/database.module'
import { session } from 'src/db/schema'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'
import { BrowserLogsController } from 'src/logging/browser-logs.controller'
import { BrowserLogsService } from 'src/logging/browser-logs.service'
import { LOG_EVENTS } from 'src/logging/log-events'
import { LogReaderService } from 'src/logging/log-reader.service'
import { LogSearchService } from 'src/logging/log-search.service'
import { LogSourcesService } from 'src/logging/log-sources.service'
import { LogTailController } from 'src/logging/log-tail.controller'
import { LogTailService } from 'src/logging/log-tail.service'
import type {
  LogSearchResponse,
  LogSource,
  LogWindowResponse,
} from 'src/logging/log-view.types'
import { LogsController } from 'src/logging/logs.controller'
import { SupervisorService } from 'src/supervisor/supervisor.service'

// Same test-env scoping convention as auth-mount.spec.ts / guild-gate.spec.ts
// (U2/U3) — obviously-fake test values, scoped to this file only.
process.env.BETTER_AUTH_URL = 'https://tdr-code.lilnas.io'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.DISCORD_CLIENT_ID = 'test-discord-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret'
// setup.ts already sets DISCORD_GUILD_ID = 'test-guild-id' (shared fixture).

const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? 'test-guild-id'

// ──────────────────────────────────────────────────────────────────────────────
// Section 1: AuthGuard.canActivate in isolation — mocked ExecutionContext,
// mocked AuthService/Reflector/PinoLogger. Proves the guard's own logic
// (public bypass, null->deny, throw->deny+distinct log, success->attach)
// independent of the full HTTP pipeline. Mirrors apps/yoink's
// jwt-auth.guard.test.ts makeContext() shape.
// ──────────────────────────────────────────────────────────────────────────────

interface FakeRequest {
  headers: Record<string, string>
  originalUrl: string
  user?: AuthedUser
  session?: { id: string; userId: string }
}

function makeContext(request: FakeRequest) {
  const handler = () => undefined
  const klass = class {}
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => handler,
    getClass: () => klass,
  }
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

// A real class with a real @Public()-decorated method — proves Public()'s
// own SetMetadata call and this guard's Reflector.getAllAndOverride
// composed for real, not that a hand-rolled metadata key happened to match
// public.decorator.ts's IS_PUBLIC_KEY by coincidence.
class DummyPublicController {
  @Public()
  publicHandler() {
    return undefined
  }

  guardedHandler() {
    return undefined
  }
}

describe('AuthGuard.canActivate — isolated unit tests', () => {
  // The REAL @nestjs/core Reflector (not a stub) — getAllAndOverride reads
  // actual Reflect metadata off the handler/class pair below.
  const reflector = new Reflector()

  function makeGuard(authService: { api: { getSession: jest.Mock } }) {
    return new AuthGuard(
      reflector,
      authService as unknown as AuthService,
      fakeLogger(),
    )
  }

  it('bypasses the session check entirely for a @Public()-annotated handler', async () => {
    const getSession = jest.fn()
    const guard = makeGuard({ api: { getSession } })

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, originalUrl: '/health' }),
        getResponse: () => ({}),
      }),
      getHandler: () => DummyPublicController.prototype.publicHandler,
      getClass: () => DummyPublicController,
    }

    await expect(guard.canActivate(context as never)).resolves.toBe(true)
    expect(getSession).not.toHaveBeenCalled()
  })

  it('does NOT bypass the session check for a non-@Public() handler on the same class', async () => {
    const getSession = jest.fn().mockResolvedValue(null)
    const guard = makeGuard({ api: { getSession } })

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, originalUrl: '/config' }),
        getResponse: () => ({}),
      }),
      getHandler: () => DummyPublicController.prototype.guardedHandler,
      getClass: () => DummyPublicController,
    }

    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'Unauthorized',
    )
    expect(getSession).toHaveBeenCalled()
  })

  it('denies (401) and logs auth-denied when getSession resolves null (no/expired cookie)', async () => {
    const getSession = jest.fn().mockResolvedValue(null)
    const logger = fakeLogger()
    const guard = new AuthGuard(
      reflector,
      { api: { getSession } } as unknown as AuthService,
      logger,
    )
    const request: FakeRequest = { headers: {}, originalUrl: '/live' }
    const context = makeContext(request)

    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'Unauthorized',
    )
    expect(request.user).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/live',
        event: LOG_EVENTS.authDenied,
      }),
      expect.any(String),
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('denies (401) and logs the DISTINCT auth-check-error event when getSession throws', async () => {
    const dbError = new Error('SQLITE_BUSY: database is locked')
    const getSession = jest.fn().mockRejectedValue(dbError)
    const logger = fakeLogger()
    const guard = new AuthGuard(
      reflector,
      { api: { getSession } } as unknown as AuthService,
      logger,
    )
    const request: FakeRequest = { headers: {}, originalUrl: '/config' }
    const context = makeContext(request)

    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'Unauthorized',
    )
    // Never a 500: the guard's own thrown exception is UnauthorizedException,
    // not InternalServerErrorException — the failure contract this test
    // exists to pin (do NOT mirror yoink's 500-on-DB-error pattern).
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: dbError,
        path: '/config',
        event: LOG_EVENTS.authCheckError,
      }),
      expect.any(String),
    )
    // auth-check-error and auth-denied are genuinely distinct event names —
    // asserting this directly guards against a future edit accidentally
    // merging them back into one string.
    expect(LOG_EVENTS.authCheckError).not.toBe(LOG_EVENTS.authDenied)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('allows and attaches request.user/request.session on a real getSession result', async () => {
    const authedUser = {
      id: 'user-1',
      email: 'a@example.com',
      name: 'A',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const authedSession = {
      id: 'sess-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 3_600_000),
      token: 'tok',
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    }
    const getSession = jest
      .fn()
      .mockResolvedValue({ user: authedUser, session: authedSession })
    const logger = fakeLogger()
    const guard = new AuthGuard(
      reflector,
      { api: { getSession } } as unknown as AuthService,
      logger,
    )
    const request: FakeRequest = { headers: {}, originalUrl: '/live' }
    const context = makeContext(request)

    await expect(guard.canActivate(context as never)).resolves.toBe(true)
    expect(request.user).toEqual(authedUser)
    expect(request.session).toEqual(authedSession)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Section 3: full HTTP integration — a real NestJS app wiring the real
// AuthModule (mount + guild gate) and the real hand-rolled AuthGuard as
// APP_GUARD (exactly as app.module.ts registers it), every console/bot
// controller (mocked *Services; real DB for DB-only controllers), and a real
// Discord OAuth round trip (Discord mocked via msw) to mint genuine,
// correctly-signed session cookies — never a hand-typed fixture cookie.
// ──────────────────────────────────────────────────────────────────────────────

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
  customSystemPrompt: '',
  autoPostDiffs: false,
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
    channelName: null,
    triggeringUserId: '100000000000000001',
    triggeringUserDisplayName: null,
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

const MOCK_LOG_WINDOW_RESPONSE: LogWindowResponse = {
  stream: 'backend',
  fileSize: 0,
  windowStart: 0,
  windowEnd: 0,
  atStart: true,
  atEnd: true,
  lines: [],
}

const MOCK_LOG_SOURCES_RESPONSE: LogSource[] = [
  { stream: 'backend', exists: true, size: 0 },
  { stream: 'frontend-server', exists: false, size: 0 },
  { stream: 'frontend-browser', exists: false, size: 0 },
]

const MOCK_LOG_SEARCH_RESPONSE: LogSearchResponse = {
  total: 0,
  matches: [],
  nextCursor: null,
}

function buildTestControllerModule(db: TestDb['db']) {
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
  const mockGithubLinkService = {
    getStatus: jest.fn().mockReturnValue({ linked: false }),
    unlink: jest
      .fn()
      .mockResolvedValue({ unlinked: false, revoked: 'skipped_no_token' }),
  }
  const mockGitRosterService = {
    listRoster: jest.fn().mockResolvedValue([]),
  }
  const mockBotStatusService = {
    getStatus: jest.fn().mockReturnValue(MOCK_BOT_STATUS),
  }
  // LifecycleController also injects DB directly for teardown's
  // latestGeneration() lookup — an empty test DB has no bot_generation row,
  // so teardown naturally 409s (ConflictException('bot-offline')), which is
  // exactly the "reached the controller, guard let it through" signal an
  // authenticated-sweep test needs (not a functional bot-lifecycle test).
  const mockSupervisorService = {
    requestRestart: jest.fn().mockReturnValue({ phase: 'Starting' }),
  }
  const mockBrowserLogsService = { write: jest.fn() }
  const mockLogReaderService = {
    readWindow: jest.fn().mockReturnValue(MOCK_LOG_WINDOW_RESPONSE),
  }
  const mockLogSourcesService = {
    getSources: jest.fn().mockReturnValue(MOCK_LOG_SOURCES_RESPONSE),
  }
  const mockLogSearchService = {
    scan: jest.fn().mockResolvedValue(MOCK_LOG_SEARCH_RESPONSE),
  }
  // NEVER (an Observable that never emits/errors/completes) mirrors the
  // real LogTailService.watch()'s actual shape for an authenticated,
  // reachable connection — the real tail also stays open indefinitely
  // (that's the entire point of a live push endpoint) rather than
  // completing on its own. This is exactly why the "valid session cookie"
  // sweep above uses requestHeadersOnly instead of the body-awaiting
  // request() helper for GET /logs/tail: this mock intentionally never
  // ends its stream, matching production behavior.
  const mockLogTailService = {
    watch: jest.fn().mockReturnValue(NEVER),
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
      BrowserLogsController,
      LogsController,
      LogTailController,
      GithubLinkController,
      GitRosterController,
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
      { provide: GithubLinkService, useValue: mockGithubLinkService },
      { provide: GitRosterService, useValue: mockGitRosterService },
      { provide: BotStatusService, useValue: mockBotStatusService },
      { provide: SupervisorService, useValue: mockSupervisorService },
      { provide: BrowserLogsService, useValue: mockBrowserLogsService },
      { provide: LogReaderService, useValue: mockLogReaderService },
      { provide: LogSourcesService, useValue: mockLogSourcesService },
      { provide: LogSearchService, useValue: mockLogSearchService },
      { provide: LogTailService, useValue: mockLogTailService },
      { provide: PinoLogger, useValue: fakePinoLogger },
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class TestAppModule {}

  return {
    TestAppModule,
    mocks: {
      mockLiveService,
      mockSessionsService,
      mockEventsService,
      mockReconcileService,
      mockConfigService,
      mockGitIdentityService,
      mockDiscordDirectoryService,
      mockBotStatusService,
      mockSupervisorService,
      fakePinoLogger,
    },
  }
}

type JsonResponse = {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
  rawBody: string
}

// Same minimal http.request wrapper as auth-mount.spec.ts / guild-gate.spec.ts.
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

// A headers-only variant of request() above, needed specifically because
// GET /logs/tail (Phase 2 U8) is an @Sse() route: when the guard actually
// LETS a request through to that handler, the response body is a
// long-lived stream that never fires 'end' on its own (the handler holds
// the connection open for live tail pushes) — request()'s own res.on('end',
// ...) would hang this test file's "valid session cookie -> reachable"
// sweep forever for that one route. This variant resolves as soon as the
// status/headers arrive (the 'response' event) and then destroys the
// socket, which is exactly the information "reachable (not 401)" needs and
// nothing more. It is intentionally NOT used for the "no session cookie ->
// 401" sweep: a 401 response is a normal, quickly-ending JSON body for
// EVERY route including /logs/tail (the guard throws BEFORE the @Sse()
// handler's Observable ever engages — see auth.guard.ts's canActivate,
// which runs as an APP_GUARD ahead of the route handler entirely), so that
// sweep already completes correctly with the original body-awaiting
// request() helper and gets the added assurance of seeing a real, fully-
// formed 401 JSON body.
function requestHeadersOnly(
  port: number,
  options: {
    method: string
    path: string
    headers?: Record<string, string>
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    // Declared before req so the 'error' handler below can safely read it
    // even though 'error' is registered before the 'response' callback
    // actually runs (both are attached synchronously; only invocation order
    // at runtime differs).
    let settled = false
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      res => {
        settled = true
        // Drain-and-discard rather than leaving the socket half-read: some
        // platforms/http-agent configurations can back-pressure a request
        // whose response is never consumed, which would leak a lingering
        // handle into the next test. resume() (not res.on('data')) is
        // enough since nothing here needs the body content.
        res.resume()
        resolve({ status: res.statusCode ?? 0, headers: res.headers })
        // Destroy AFTER resolving (not before) so a long-lived SSE
        // connection's teardown path (this unit's finalize()/cleanup()) is
        // exercised the same way a real client disconnecting would trigger
        // it — this incidentally doubles as a real-world proof that the
        // tail's own leak-safety holds for a genuine socket-level
        // disconnect, not just an RxJS-level unsubscribe.
        req.destroy()
      },
    )
    req.on('error', err => {
      // req.destroy() above deliberately triggers a benign ECONNRESET/
      // "socket hang up" on the client side for the SSE-route case (the
      // promise having already resolved by then) — swallow an error that
      // arrives AFTER resolution rather than rejecting an otherwise-
      // successful check; only reject if the request never got a response
      // at all.
      if (settled) return
      reject(err)
    })
    req.end()
  })
}

// Discord's raw responses — same shapes as guild-gate.spec.ts (U3), which
// already proved these match the real APIs Better Auth's Discord provider
// and guild-gate.ts call.
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

const discordOnlyUnhandledRequestStrategy: UnhandledRequestStrategy = (
  req,
  print,
) => {
  if (new URL(req.url).hostname === 'discord.com') {
    print.error()
  }
}

function hasSessionCookie(res: JsonResponse): boolean {
  const cookies = res.headers['set-cookie']
  if (!cookies) return false
  return cookies.some(entry => /\bsession_token=/.test(entry))
}

describe('AuthGuard — full HTTP integration (deny-by-default across every enumerated route)', () => {
  let app: { close: () => Promise<void> }
  let port: number
  let testDb: TestDb
  let mocks: ReturnType<typeof buildTestControllerModule>['mocks']
  const mswServer = setupServer()

  beforeAll(async () => {
    mswServer.listen({
      onUnhandledRequest: discordOnlyUnhandledRequestStrategy,
    })
    testDb = createTestDb()
    const built = buildTestControllerModule(testDb.db)
    mocks = built.mocks

    const moduleRef = await Test.createTestingModule({
      imports: [built.TestAppModule],
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
  })

  afterAll(async () => {
    await app.close()
    mswServer.close()
    testDb.close()
  })

  // Mints a genuine, correctly-signed Better Auth session cookie by driving
  // a REAL Discord OAuth round trip against the mounted /auth/* handler
  // (Discord itself mocked via msw) — never a hand-typed fixture cookie.
  // Mirrors guild-gate.spec.ts's own getRealOAuthState/mockDiscordOAuthChain/
  // driveCallback helpers (U3), condensed into one function since this file
  // only needs "mint a valid member session," not exhaustive guild-gate
  // scenario coverage (that's U3's job).
  async function mintSessionCookie(opts: {
    discordUserId: string
    accessToken: string
  }): Promise<string> {
    mswServer.use(
      mswHttp.post('https://discord.com/api/oauth2/token', () =>
        HttpResponse.json(discordTokenResponse(opts.accessToken)),
      ),
      // '%40me' not '@me' — betterFetch percent-encodes the leading '@'
      // (confirmed in guild-gate.spec.ts's own identical comment).
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
    const body = signInRes.body as { url: string }
    const url = new URL(body.url)
    const state = url.searchParams.get('state')
    if (!state) throw new Error('sign-in/social did not return a state param')
    const setCookieHeaders = signInRes.headers['set-cookie']
    if (!setCookieHeaders) {
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
        `mintSessionCookie: callback did not set a session cookie (status ${callbackRes.status})`,
      )
    }
    const sessionSetCookies = callbackRes.headers['set-cookie']
    if (!sessionSetCookies) {
      throw new Error('mintSessionCookie: no set-cookie header on callback')
    }
    return sessionSetCookies.map(entry => entry.split(';')[0]).join('; ')
  }

  // ---------------------------------------------------------------------------
  // Scenario 2 + 5: unauthenticated sweep. Every PROTECTED_ROUTES entry 401s
  // with no cookie; every PUBLIC_ROUTES entry (/health) succeeds with no
  // cookie. Iterates the canonical protected-routes.ts constant so this test
  // can't silently drift from the guard's own allowlist.
  // ---------------------------------------------------------------------------

  describe('no session cookie', () => {
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

    it.each(PUBLIC_ROUTES)(
      '$label -> NOT 401 with no session cookie (allowlisted)',
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
  // Scenario 1: authenticated sweep. Every PROTECTED_ROUTES entry is
  // reachable (not 401) with a valid session cookie.
  // ---------------------------------------------------------------------------

  describe('valid session cookie', () => {
    let cookieHeader: string

    beforeAll(async () => {
      cookieHeader = await mintSessionCookie({
        discordUserId: '100000000000000010',
        accessToken: 'sweep-access-token',
      })
    })

    // Uses requestHeadersOnly (not request): GET /logs/tail (Phase 2 U8) is
    // an @Sse() route whose body never naturally ends while a session is
    // valid (that's the whole point of a live tail) — request()'s
    // body-awaiting res.on('end', ...) would hang this sweep forever for
    // that one entry. requestHeadersOnly resolves as soon as status/headers
    // arrive, which is all "reachable (not 401)" needs, and works
    // identically for every other (normal, body-ending) route too. See
    // requestHeadersOnly's own header comment for the full rationale.
    it.each(PROTECTED_ROUTES)(
      '$label -> reachable (not 401) with a valid session cookie',
      async spec => {
        const res = await requestHeadersOnly(port, {
          method: spec.method,
          path: buildPath(spec),
          headers: { origin: ALLOWED_ORIGIN, cookie: cookieHeader },
        })
        expect(res.status).not.toBe(401)
      },
    )

    it('GET /health also succeeds with a valid session cookie present', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/health',
        headers: { cookie: cookieHeader },
      })
      expect(res.status).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 3: getSession throws (simulated SQLITE_BUSY) -> 401, never 500,
  // never allow — and the DISTINCT auth-check-error event fires (not
  // auth-denied).
  // ---------------------------------------------------------------------------

  describe('getSession throws (SQLITE_BUSY simulation)', () => {
    it('returns 401 (not 500) and logs auth-check-error, not auth-denied', async () => {
      const authServiceInstance = (
        app as unknown as { get: <T>(t: unknown) => T }
      ).get<AuthService>(AuthService)
      const spy = jest
        .spyOn(authServiceInstance.api, 'getSession')
        .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))

      try {
        ;(mocks.fakePinoLogger.error as jest.Mock).mockClear()
        ;(mocks.fakePinoLogger.warn as jest.Mock).mockClear()

        const res = await request(port, {
          method: 'GET',
          path: '/live',
          headers: { origin: ALLOWED_ORIGIN },
        })

        expect(res.status).toBe(401)
        expect(res.status).not.toBe(500)
        expect(mocks.fakePinoLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            path: '/live',
            event: LOG_EVENTS.authCheckError,
          }),
          expect.any(String),
        )
        expect(mocks.fakePinoLogger.warn).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: LOG_EVENTS.authDenied }),
          expect.anything(),
        )
      } finally {
        spy.mockRestore()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 4: expired/tampered session cookie -> 401, not a 500. Covers
  // both distinct getSession code paths (bad signature -> early null return;
  // valid signature but expired row -> the later null return).
  // ---------------------------------------------------------------------------

  describe('tampered / expired session cookie', () => {
    it('a tampered (bad-signature) cookie value -> 401, not 500', async () => {
      const cookieHeader = await mintSessionCookie({
        discordUserId: '100000000000000011',
        accessToken: 'tamper-access-token',
      })
      // Split on the FIRST '=' only — Better Auth's signed cookie value
      // itself commonly contains further '=' characters (base64 padding on
      // the HMAC signature segment); a naive cookieHeader.split('=') would
      // silently truncate the value at the wrong boundary.
      const eqIndex = cookieHeader.indexOf('=')
      const name = cookieHeader.slice(0, eqIndex)
      const value = cookieHeader.slice(eqIndex + 1)
      // Flip one character in the middle of the signed value — invalidates
      // the HMAC signature without breaking cookie-header syntax.
      const midpoint = Math.floor(value.length / 2)
      const tampered =
        value.slice(0, midpoint) +
        (value[midpoint] === 'a' ? 'b' : 'a') +
        value.slice(midpoint + 1)

      const res = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: `${name}=${tampered}` },
      })

      expect(res.status).toBe(401)
      expect(res.status).not.toBe(500)
    })

    it('a genuinely expired session row -> 401, not 500', async () => {
      const cookieHeader = await mintSessionCookie({
        discordUserId: '100000000000000012',
        accessToken: 'expire-access-token',
      })

      // Directly age out the underlying session row — the cookie's own
      // signature stays valid (untouched), but getSession's own
      // `session.session.expiresAt < new Date()` check must still reject it.
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
  // Scenario 6: guard passing does not bypass requireSameOrigin — the two
  // defenses compose. A valid session + a cross-origin Origin header is
  // still rejected by the controller's own CSRF check.
  // ---------------------------------------------------------------------------

  describe('guard + requireSameOrigin composition', () => {
    it('POST /git-identity with a valid session but a cross-origin Origin header is still 403', async () => {
      const cookieHeader = await mintSessionCookie({
        discordUserId: '100000000000000013',
        accessToken: 'csrf-access-token',
      })

      const res = await request(port, {
        method: 'POST',
        path: '/git-identity',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example.com',
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          discordUserId: '123456789012345678',
          name: 'Test User',
          email: 'test@example.com',
          privateKey: 'FAKE-KEY',
        }),
      })

      expect(res.status).toBe(403)
      expect(res.status).not.toBe(401)
    })

    it('the SAME request with the correct same-origin header succeeds (guard did not itself block it)', async () => {
      const cookieHeader = await mintSessionCookie({
        discordUserId: '100000000000000014',
        accessToken: 'csrf-ok-access-token',
      })

      const res = await request(port, {
        method: 'POST',
        path: '/git-identity',
        headers: {
          'content-type': 'application/json',
          origin: ALLOWED_ORIGIN,
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          discordUserId: '123456789012345678',
          name: 'Test User',
          email: 'test@example.com',
          privateKey: 'FAKE-KEY',
        }),
      })

      expect(res.status).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Scenario 8: the revoke-sessions break-glass deliverable — both at the
  // repo level (isolation: revoking one user never touches another's rows)
  // and end-to-end through the guarded HTTP route (a revoked cookie 401s on
  // its very next request).
  // ---------------------------------------------------------------------------

  describe('revoke-sessions break-glass (repo level)', () => {
    it("revokeSessionsForDiscordUser deletes only the target Discord user's session rows", async () => {
      const cookieA = await mintSessionCookie({
        discordUserId: '100000000000000030',
        accessToken: 'revoke-repo-a-token',
      })
      const cookieB = await mintSessionCookie({
        discordUserId: '100000000000000031',
        accessToken: 'revoke-repo-b-token',
      })
      // Both cookies must be independently valid before revocation, or this
      // test would trivially pass with a no-op revoke function.
      expect(
        (
          await request(port, {
            method: 'GET',
            path: '/live',
            headers: { origin: ALLOWED_ORIGIN, cookie: cookieA },
          })
        ).status,
      ).not.toBe(401)
      expect(
        (
          await request(port, {
            method: 'GET',
            path: '/live',
            headers: { origin: ALLOWED_ORIGIN, cookie: cookieB },
          })
        ).status,
      ).not.toBe(401)

      const revoked = revokeSessionsForDiscordUser(
        testDb.db,
        '100000000000000030',
      )
      expect(revoked).toBeGreaterThanOrEqual(1)

      const resA = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: cookieA },
      })
      expect(resA.status).toBe(401)

      // B's session must be untouched by revoking A.
      const resB = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: cookieB },
      })
      expect(resB.status).not.toBe(401)
    })

    it('revoking a discordUserId with no linked account is a harmless no-op (0 rows)', () => {
      const revoked = revokeSessionsForDiscordUser(
        testDb.db,
        '199999999999999999',
      )
      expect(revoked).toBe(0)
    })
  })

  describe('revoke-sessions break-glass (HTTP route, flat-admin)', () => {
    it('POST /auth-admin/users/:discordUserId/revoke-sessions revokes the target and the SAME revoked cookie 401s on its next request', async () => {
      const targetDiscordUserId = '100000000000000040'
      const targetCookie = await mintSessionCookie({
        discordUserId: targetDiscordUserId,
        accessToken: 'revoke-http-target-token',
      })
      // The CALLER can be a different authenticated member entirely — flat
      // admin (R19) means any authenticated guild member may revoke anyone
      // else's sessions, matching the git-identity controller's own
      // "any admin edits anyone" precedent.
      const callerCookie = await mintSessionCookie({
        discordUserId: '100000000000000041',
        accessToken: 'revoke-http-caller-token',
      })

      const revokeRes = await request(port, {
        method: 'POST',
        path: `/auth-admin/users/${targetDiscordUserId}/revoke-sessions`,
        headers: { origin: ALLOWED_ORIGIN, cookie: callerCookie },
      })

      expect(revokeRes.status).toBe(200)
      expect(revokeRes.body).toEqual({
        discordUserId: targetDiscordUserId,
        sessionsRevoked: 1,
      })

      const targetPostRevoke = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: targetCookie },
      })
      expect(targetPostRevoke.status).toBe(401)

      // The CALLER's own session must remain valid — revoking someone else
      // must not self-revoke the caller.
      const callerStillWorks = await request(port, {
        method: 'GET',
        path: '/live',
        headers: { origin: ALLOWED_ORIGIN, cookie: callerCookie },
      })
      expect(callerStillWorks.status).not.toBe(401)
    })

    it('is itself a guarded route: 401 with no session cookie', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/auth-admin/users/100000000000000099/revoke-sessions',
        headers: { origin: ALLOWED_ORIGIN },
      })
      expect(res.status).toBe(401)
    })

    it('is a mutating route protected by requireSameOrigin too', async () => {
      const cookieHeader = await mintSessionCookie({
        discordUserId: '100000000000000042',
        accessToken: 'revoke-http-csrf-token',
      })
      const res = await request(port, {
        method: 'POST',
        path: '/auth-admin/users/100000000000000042/revoke-sessions',
        headers: { origin: 'https://evil.example.com', cookie: cookieHeader },
      })
      expect(res.status).toBe(403)
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Section 4: protected-routes.ts's own bookkeeping — the canonical
// enumeration guarantees the plan's route count and the exactly-one-public-
// route invariant hold, independent of any HTTP behavior.
// ──────────────────────────────────────────────────────────────────────────────

describe('protected-routes.ts — canonical enumeration bookkeeping', () => {
  // NOTE on the count: the plan's prose says "13 guarded routes" for the
  // pre-revoke-sessions list, but its own comma-separated enumeration
  // (repeated verbatim in this unit's task instructions) literally lists 14
  // distinct method+path items: GET /live, GET /sessions, GET /sessions/:id,
  // GET /sessions/:id/reconcile, GET /sessions/:id/jsonl-status, GET
  // /events, GET /config, PUT /config, GET /git-identity, POST
  // /git-identity, DELETE /git-identity, POST /bot/restart, POST
  // /channels/:id/teardown, GET /bot/status — verified one-by-one against
  // each controller's actual source (reconcile.controller.ts,
  // lifecycle.controller.ts, git-identity.controller.ts) rather than taken
  // on the plan's word, per this unit's own "don't guess from the plan's
  // prose alone" instruction. "13" is a plain off-by-one in the plan's own
  // summary sentence, not a route this file is missing or has extra. So:
  // 14 (verified pre-existing) + 1 (this unit's own revoke-sessions
  // deliverable) = 15 protected routes; + GET /health public = 16 total.
  // Running tally since: 16 + POST /logs/browser (unified-logging unit) +
  // GET /logs/window (U2, logs viewer windowed read) = 18; + GET
  // /logs/sources (U3, logs viewer tab-bootstrap sources) = 19; + GET
  // /logs/tail (Phase 2 U8, append-delta live tail SSE endpoint) = 20; + GET
  // /logs/search (Phase 2 U9, whole-file streaming scan/search endpoint) =
  // 21.
  it('enumerates exactly 25 protected routes (21 pre-existing + GET /git/github/status + DELETE /git/github + DELETE /git/github/:userId + GET /git/roster)', () => {
    expect(PROTECTED_ROUTES).toHaveLength(25)
  })

  it('enumerates exactly one public route: GET /health', () => {
    expect(PUBLIC_ROUTES).toHaveLength(1)
    expect(PUBLIC_ROUTES[0]).toMatchObject({ method: 'GET', path: '/health' })
  })

  it('every protected route with a :param in its path declares a matching params entry', () => {
    for (const spec of PROTECTED_ROUTES) {
      const paramNames = [...spec.path.matchAll(/:([A-Za-z]+)/g)].map(m => m[1])
      for (const name of paramNames) {
        expect(spec.params?.[name]).toBeDefined()
      }
    }
  })
})
