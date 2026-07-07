import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
// pino ships `export =` merged with a same-named namespace (for pino.Logger,
// pino.DestinationStream, etc.) — the import/no-named-as-default warning is
// a known false positive for this pattern; `pino` is the library's own
// documented canonical import name (see pino's own README/docs).
// eslint-disable-next-line import/no-named-as-default
import pino from 'pino'

import { buildAuth } from 'src/auth/auth'
import { AuthModule } from 'src/auth/auth.module'
import { ConfigController } from 'src/console/config.controller'
import type { ConfigResponseDto } from 'src/console/config.dto'
import { ConfigService } from 'src/console/config.service'
import { DiscordDirectoryService } from 'src/console/discord-directory.service'
import { GitIdentityController } from 'src/console/git-identity.controller'
import type { UpsertGitIdentityResponseDto } from 'src/console/git-identity.dto'
import { GitIdentityService } from 'src/console/git-identity.service'
import { DB } from 'src/db/database.module'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'
import { EnvKeys } from 'src/env'
import { buildLoggerOptions } from 'src/logger'

// This suite proves the U2 wiring end-to-end: a real NestFactory-created app
// (bodyParser: false, exactly as bootstrap.ts configures it), the real
// AuthModule (real betterAuth() instance from auth.ts, mounted via the real
// @thallesp/nestjs-better-auth), and real console controllers with mocked
// SERVICES only (mirroring config.controller.spec.ts / git-identity
// .controller.spec.ts's makeService() pattern) — so the body-parser split is
// exercised with actual HTTP requests, not unit-level controller calls.
//
// These four env keys are scoped to THIS file only (not added to the shared
// src/__tests__/setup.ts, since no other spec touches Better Auth yet) — all
// four values below are obviously-fake test values, never real secrets.
// BETTER_AUTH_URL matches the default ALLOWED_CONSOLE_ORIGIN/trustedOrigins
// value so origin-config parity holds inside the test too.
process.env.BETTER_AUTH_URL = 'https://tdr-code.lilnas.io'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.DISCORD_CLIENT_ID = 'test-discord-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret'

const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

// Mirrors DatabaseModule's shape (see database.module.ts's own comment: "DB
// is global (@Global DatabaseModule) — no DatabaseModule import needed") so
// AuthModule's forRootAsync({ inject: [DB], ... }) factory resolves DB
// without this test module needing to import anything extra.
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
}

const MOCK_GIT_IDENTITY_RESPONSE: UpsertGitIdentityResponseDto = {
  discordUserId: '123456789012345678',
  fingerprint: 'SHA256:fake-fingerprint-for-test',
  status: 'configured',
}

function makeMockConfigService(): jest.Mocked<ConfigService> {
  return {
    getConfig: jest.fn().mockReturnValue(MOCK_CONFIG_RESPONSE),
    updateConfig: jest.fn().mockReturnValue(MOCK_CONFIG_RESPONSE),
  } as unknown as jest.Mocked<ConfigService>
}

function makeMockGitIdentityService(): jest.Mocked<GitIdentityService> {
  return {
    listIdentities: jest.fn().mockReturnValue([]),
    upsertIdentity: jest.fn().mockReturnValue(MOCK_GIT_IDENTITY_RESPONSE),
    deleteIdentity: jest.fn(),
  } as unknown as jest.Mocked<GitIdentityService>
}

// GitIdentityController's second constructor dependency (added alongside its
// GET /git-identity/discord-members route) — unmocked here would fail
// TestAppModule compilation with a Nest DI error, since this suite builds its
// own minimal module rather than importing ConsoleModule wholesale.
function makeMockDiscordDirectoryService(): jest.Mocked<DiscordDirectoryService> {
  return {
    listGuildMembers: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<DiscordDirectoryService>
}

type JsonResponse = {
  status: number
  headers: http.IncomingHttpHeaders
  body: unknown
  rawBody: string
}

// No supertest in this workspace (confirmed: not a dependency of any package
// in the monorepo) — a tiny http.request wrapper is enough for the black-box
// assertions this suite needs (status/headers/body over a real socket to the
// app's ephemeral listen port).
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

describe('Better Auth NestJS mount (U2)', () => {
  // Deliberately NOT typed as the @nestjs/common INestApplication interface:
  // @nestjs/testing isn't a declared dependency of this app (it resolves via
  // pnpm hoisting from elsewhere in the monorepo, matching the existing
  // health.controller.spec.ts precedent), so its own createNestApplication()
  // return value is structurally tied to a DIFFERENT resolved copy of
  // @nestjs/common than the one this app depends on directly — annotating
  // against the "wrong" copy's INestApplication trips a cross-package
  // nominal-type mismatch. Only `close()` is actually used below, so a
  // minimal structural type is both correct and dependency-version-proof.
  let app: { close: () => Promise<void> }
  let port: number
  let testDb: TestDb
  let mockConfigService: jest.Mocked<ConfigService>
  let mockGitIdentityService: jest.Mocked<GitIdentityService>
  let mockDiscordDirectoryService: jest.Mocked<DiscordDirectoryService>

  beforeAll(async () => {
    testDb = createTestDb()
    mockConfigService = makeMockConfigService()
    mockGitIdentityService = makeMockGitIdentityService()
    mockDiscordDirectoryService = makeMockDiscordDirectoryService()

    const TestDatabaseModule = makeTestDatabaseModule(testDb.db)

    @Module({
      imports: [TestDatabaseModule, AuthModule],
      controllers: [ConfigController, GitIdentityController],
      providers: [
        { provide: ConfigService, useValue: mockConfigService },
        { provide: GitIdentityService, useValue: mockGitIdentityService },
        {
          provide: DiscordDirectoryService,
          useValue: mockDiscordDirectoryService,
        },
      ],
    })
    class TestAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile()

    // bodyParser: false is the exact flag bootstrap.ts passes to
    // NestFactory.create — this is the setting under test. helmet()/
    // cookieParser() are app.use() middleware ahead of any router-level body
    // parsing either way (they read headers/cookies, never the body), so
    // they're omitted here without weakening the body-parser assertions;
    // U2's job is proving the AuthModule + bodyParser:false combination,
    // not re-testing helmet/cookie-parser themselves.
    //
    // nestApp's type is inferred directly from createNestApplication()'s
    // return value (not the outer narrow-typed `app`), so init()/listen()/
    // getHttpServer() below see the full interface; only the final
    // `app = nestApp` assignment narrows it, which structural typing always
    // permits (a richer object satisfies a variable requiring fewer members).
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

  afterAll(async () => {
    await app.close()
    testDb.close()
  })

  describe('Better Auth handler reachability (post-strip internal path)', () => {
    // Load-bearing assertion: the betterAuth() instance's basePath ('/auth')
    // must match what @thallesp's SkipBodyParsingMiddleware/mount match
    // against req.originalUrl. This request simulates exactly what NestJS
    // sees after Next's rewrite strips '/api' (next.config.js:
    // '/api/:path*' -> ':path*'). POST (not GET) + { provider: 'discord' }
    // is the real signInSocial route contract (confirmed against
    // better-auth's dist/api/routes/sign-in.mjs — method: "POST", body
    // requires only `provider`).
    it('POST /auth/sign-in/social reaches the Better Auth handler and returns a real Discord authorize URL, not a 404', async () => {
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
      const body = res.body as { url?: string; redirect?: boolean }
      expect(typeof body.url).toBe('string')
      expect(body.url).toContain('discord.com')
      expect(body.redirect).toBe(true)
      // signInSocial also sets a Location header alongside the JSON body
      // (dist/api/routes/sign-in.mjs: c.setHeader("Location", url) unless
      // disableRedirect) — same URL, belt-and-suspenders check.
      expect(res.headers.location).toBe(body.url)
    })

    // The route existing and returning a 200 with real Discord-authorize
    // content is only possible if signInSocial's `c.body.provider` was
    // actually populated — which requires the RAW request body to have
    // reached Better Auth's own handler unconsumed. If bodyParser:false +
    // the skip-middleware were wired wrong (basePath mismatch, or
    // express.json() ran first and drained the stream), this would 404
    // (PROVIDER_NOT_FOUND, since c.body.provider would be undefined) or the
    // request would hang/error — not return a well-formed Discord URL. This
    // is the same request as the test above; asserted again here, framed
    // explicitly against the plan's "raw body reaches the handler" scenario.
    it('the raw POST body reaches the Better Auth handler unconsumed by express.json()', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/auth/sign-in/social',
        headers: {
          'content-type': 'application/json',
          origin: ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ provider: 'discord' }),
      })

      expect(res.status).not.toBe(404)
      const body = res.body as { url?: string }
      expect(body.url).toBeDefined()
    })

    it('an unknown path under /auth/* still reaches the Better Auth handler (not a raw 404 from Nest routing)', async () => {
      // Better Auth's own router 404s unknown sub-paths — the point here is
      // that the REQUEST reaches better-auth's handler at all (proven by a
      // Better Auth error-shaped body, not Nest's default "Cannot POST
      // /auth/..." 404 page), confirming basePath matching is prefix-based
      // as expected, not an exact single-route match.
      const res = await request(port, {
        method: 'GET',
        path: '/auth/does-not-exist',
        headers: { origin: ALLOWED_ORIGIN },
      })

      expect(res.status).toBe(404)
      // Nest's own default 404 (if the request never reached the mount at
      // all — e.g. a basePath regression) always sends a JSON body shaped
      // like {"statusCode":404,"message":"Cannot GET ...","error":"Not
      // Found"}. Better Auth's router 404s a genuinely unmatched sub-path
      // with an EMPTY body instead (confirmed empirically) — checking the
      // raw string (always defined, even when empty) for the absence of
      // Nest's own "statusCode" field name distinguishes "Better Auth's
      // router matched the mount and then 404'd internally" from "Nest's
      // own router never found the mount at all" — res.body itself would be
      // `undefined` here (JSON.parse of an empty string), so asserting
      // against res.rawBody avoids toHaveProperty's null/undefined guard.
      expect(res.rawBody).not.toContain('statusCode')
    })
  })

  describe('console controllers still parse JSON bodies after bodyParser: false (regression guard)', () => {
    it('PUT /config parses a real JSON body into typed fields (ConfigService receives the exact object, not a raw/empty body)', async () => {
      const requestBody = {
        cwd: '/tmp',
        claudeCommand: 'claude',
        claudeArgs: ['--dangerously-skip-permissions'],
        idleTimeoutSec: 300,
        maxConcurrentSessions: 5,
        customSystemPrompt: '',
      }

      const res = await request(port, {
        method: 'PUT',
        path: '/config',
        headers: {
          'content-type': 'application/json',
          origin: ALLOWED_ORIGIN,
        },
        body: JSON.stringify(requestBody),
      })

      expect(res.status).toBe(200)
      expect(mockConfigService.updateConfig).toHaveBeenCalledWith(requestBody)
      expect(res.body).toEqual(MOCK_CONFIG_RESPONSE)
    })

    it('POST /git-identity parses a real JSON body into typed fields (GitIdentityService receives the exact object)', async () => {
      const requestBody = {
        discordUserId: '123456789012345678',
        name: 'Test User',
        email: 'test@example.com',
        privateKey: 'FAKE-PRIVATE-KEY-CONTENT-FOR-TEST',
      }

      const res = await request(port, {
        method: 'POST',
        path: '/git-identity',
        headers: {
          'content-type': 'application/json',
          origin: ALLOWED_ORIGIN,
        },
        body: JSON.stringify(requestBody),
      })

      expect(res.status).toBe(200)
      expect(mockGitIdentityService.upsertIdentity).toHaveBeenCalledWith(
        requestBody,
      )
      expect(res.body).toEqual(MOCK_GIT_IDENTITY_RESPONSE)
    })

    it('GET /config (no body) still works — the split does not regress non-body routes', async () => {
      const res = await request(port, {
        method: 'GET',
        path: '/config',
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(MOCK_CONFIG_RESPONSE)
      expect(mockConfigService.getConfig).toHaveBeenCalled()
    })
  })
})

describe('buildAuth() env validation (fail fast at boot)', () => {
  // buildAuth()'s object-literal construction evaluates env(EnvKeys.X) calls
  // eagerly (left-to-right, synchronously) before betterAuth() itself ever
  // runs — so a missing required key throws synchronously out of buildAuth(),
  // not a silent misconfiguration discovered later at request time.
  let testDb: TestDb

  beforeAll(() => {
    testDb = createTestDb()
  })

  afterAll(() => {
    testDb.close()
  })

  it.each([
    EnvKeys.BETTER_AUTH_URL,
    EnvKeys.BETTER_AUTH_SECRET,
    EnvKeys.DISCORD_CLIENT_ID,
    EnvKeys.DISCORD_CLIENT_SECRET,
  ])('missing %s fails buildAuth() fast with a clear error message', key => {
    const original = process.env[key]
    delete process.env[key]
    try {
      expect(() => buildAuth(testDb.db)).toThrow(`${key} not defined`)
    } finally {
      // Node stringifies `undefined` assigned to process.env[key] to the
      // literal string "undefined" rather than deleting it — guard against
      // that footgun even though `original` is always defined today (all
      // four keys are set at module scope above, before this describe runs).
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  })
})

describe('pino redaction (logger.ts) — real serialized output, not just config shape', () => {
  // A structural check that buildLoggerOptions() sets `redact` would pass
  // even if the paths were wrong or the censor no-op'd. These tests instead
  // feed real secret-shaped values through an ACTUAL pino instance built
  // from buildLoggerOptions()'s exact pinoHttp config and assert on the
  // serialized JSON line pino writes — the same guarantee a Loki-bound line
  // would carry in production.
  // Plain assignment to process.env.NODE_ENV is a TS error here (@types/node's
  // ProcessEnv.NODE_ENV is typed readonly via Next.js's global augmentation —
  // src/__tests__/setup.ts works around the same constraint the same way, so
  // this matches the established codebase convention rather than introducing
  // a new one).
  function setNodeEnv(value: string) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      writable: true,
    })
  }

  function loggerOptionsFor(nodeEnv: 'production' | 'development') {
    setNodeEnv(nodeEnv)
    // 'main' vs 'bot' only affects the `base.process` tag — irrelevant to
    // every assertion in this describe block, which is entirely about
    // redaction, so an arbitrary literal is fine here.
    return buildLoggerOptions('main')
  }

  afterEach(() => {
    setNodeEnv('test')
  })

  // buildLoggerOptions()'s production branch now always sets `transport`
  // (the backend.<env>.log file target, added alongside this unit's own
  // work) — pino throws ("only one of option.transport or stream can be
  // specified") if a destination is ALSO passed as pino()'s second argument
  // once `transport` is set, so the old synchronous
  // pino(pinoOptions, customDestination) capture technique no longer works
  // for the prod branch. This overrides `transport` to redirect the real
  // file target at a throwaway temp path instead (same technique the dev
  // test below already uses for its own pino-pretty transport), keeping
  // `redact`/`level`/`base` from the real config.
  async function logAndCaptureViaTransport(
    pinoHttp: object,
    logObject: object,
  ): Promise<Record<string, unknown>> {
    const outputPath = path.join(
      os.tmpdir(),
      `tdr-code-redact-test-prod-${process.pid}-${Date.now()}.log`,
    )
    const logger = pino({
      ...pinoHttp,
      transport: {
        target: 'pino/file',
        options: { destination: outputPath, mkdir: true },
      },
    })
    logger.info(logObject, 'test log line')
    try {
      const written = await pollForFileContent(outputPath, 5_000)
      return JSON.parse(written) as Record<string, unknown>
    } finally {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    }
  }

  it('production config redacts cookies, auth headers, and the OAuth query string in req.url', async () => {
    const { pinoHttp } = loggerOptionsFor('production')
    const line = await logAndCaptureViaTransport(pinoHttp, {
      req: {
        url: '/auth/callback/discord?code=OAUTHCODE123&state=STATEVAL456',
        headers: {
          cookie: 'session=SUPER-SECRET-SESSION',
          authorization: 'Bearer SUPER-SECRET-TOKEN',
        },
        body: { privateKey: 'FAKE-SSH-PRIVATE-KEY-CONTENT' },
      },
      res: { headers: { 'set-cookie': 'session=abc123; HttpOnly' } },
    })

    const req = line.req as Record<string, unknown>
    expect(req.url).toBe('/auth/callback/discord')
    const headers = req.headers as Record<string, unknown>
    expect(headers.cookie).toBe('[Redacted]')
    expect(headers.authorization).toBe('[Redacted]')
    const body = req.body as Record<string, unknown>
    expect(body.privateKey).toBe('[Redacted]')
    const res = line.res as Record<string, unknown>
    const resHeaders = res.headers as Record<string, unknown>
    expect(resHeaders['set-cookie']).toBe('[Redacted]')
    // None of the raw secret substrings survive anywhere in the serialized line.
    const raw = JSON.stringify(line)
    expect(raw).not.toContain('OAUTHCODE123')
    expect(raw).not.toContain('STATEVAL456')
    expect(raw).not.toContain('SUPER-SECRET-SESSION')
    expect(raw).not.toContain('SUPER-SECRET-TOKEN')
    expect(raw).not.toContain('FAKE-SSH-PRIVATE-KEY-CONTENT')
  })

  it('a non-auth URL keeps its query string (redaction is scoped to /auth/*, not global)', async () => {
    const { pinoHttp } = loggerOptionsFor('production')
    const line = await logAndCaptureViaTransport(pinoHttp, {
      req: { url: '/live?foo=bar' },
    })

    const req = line.req as Record<string, unknown>
    expect(req.url).toBe('/live?foo=bar')
  })

  // The plan explicitly flags this as needing verification, not assumption:
  // pretty-print transports can bypass structured redaction because they run
  // in a separate worker thread. Confirmed here: pino redacts during its
  // core JSON serialization step BEFORE handing the line to any transport
  // (including a pino-pretty worker), so the dev branch's
  // `transport: { target: 'pino-pretty' }` does not weaken redaction.
  it('dev config (pino-pretty transport) still redacts — transport worker receives already-redacted bytes', async () => {
    const { pinoHttp } = loggerOptionsFor('development')

    // Exercise the actual dev pinoHttp config (including its transport
    // option) through a real pino instance, capturing the destination
    // pino-pretty ultimately writes to (its default is stdout; redirect via
    // the transport's own `options.destination` so this test doesn't depend
    // on process.stdout). A unique-per-run filename avoids collisions with
    // parallel jest workers running this same file.
    const outputPath = path.join(
      os.tmpdir(),
      `tdr-code-redact-test-${process.pid}-${Date.now()}.log`,
    )

    const logger = pino({
      ...pinoHttp,
      transport: {
        target: 'pino-pretty',
        options: { destination: outputPath, colorize: false },
      },
    })
    logger.info(
      {
        req: {
          url: '/auth/callback/discord?code=DEVOAUTHCODE&state=DEVSTATE',
          headers: { cookie: 'session=DEV-SECRET-SESSION' },
        },
      },
      'dev transport redaction test',
    )

    try {
      // The pino-pretty transport runs in a separate worker thread, so the
      // write lands asynchronously — poll for non-empty content rather than
      // a single fixed delay (bounded at 5s, well inside the 30s test
      // timeout, but resolves as soon as the worker actually flushes).
      const written = await pollForFileContent(outputPath, 5_000)
      expect(written).not.toContain('DEVOAUTHCODE')
      expect(written).not.toContain('DEVSTATE')
      expect(written).not.toContain('DEV-SECRET-SESSION')
      expect(written).toContain('[Redacted]')
      expect(written).toContain('/auth/callback/discord')
    } finally {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    }
  })
})

// Polls for a file to exist with non-empty content, for the pino-pretty
// worker-thread transport test above (its write is asynchronous relative to
// logger.info() returning).
async function pollForFileContent(
  filePath: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      if (content.length > 0) return content
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(
    `pino-pretty transport did not write to ${filePath} within ${timeoutMs}ms`,
  )
}
