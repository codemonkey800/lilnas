import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// pino ships `export =` merged with a same-named namespace — the
// import/no-named-as-default warning is a known false positive for this
// pattern (see auth-mount.spec.ts's identical precedent).
// eslint-disable-next-line import/no-named-as-default
import pino from 'pino'

import { createLoggerSpy } from 'src/__tests__/test-utils'

import {
  BACKEND_MODULE_REDACT_PATHS,
  buildBackendLoggerOptions,
  getBackendLogger,
  initBackendLogger,
} from './backend-logger'

// Plain assignment to process.env.NODE_ENV is a TS error in this app
// (@types/node's ProcessEnv.NODE_ENV is typed readonly via Next.js's global
// augmentation) — matches the established workaround in
// src/auth/__tests__/auth-mount.spec.ts and src/__tests__/setup.ts.
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', { value, writable: true })
}

// Every real-serialization test below builds its own pino instance from
// buildBackendLoggerOptions()'s REAL level/base/redact config, but overrides
// ONLY `transport` to point at a unique-per-call temp file — mirroring
// src/auth/__tests__/auth-mount.spec.ts's logAndCaptureViaTransport /
// pollForFileContent technique for buildLoggerOptions(). This is NOT
// optional isolation theater: buildBackendLoggerOptions()'s real transport
// target is logFilePath('backend'), which is the SAME file a real main/bot
// process appends to during normal `pnpm dev` operation (by design — see
// src/logger.ts's buildLoggerOptions header comment on why one shared
// O_APPEND file across processes is safe). Confirmed empirically while
// writing this suite: with a live dev bot process running, reading "the
// last line" of the real shared file after logging raced against that
// process's own concurrent "Command poll tick complete" writes and produced
// a flaky, wrong result. Every test here instead reads back ONLY the bytes
// pino wrote to ITS OWN isolated file, so redaction is proven on real
// pino serialization without depending on what else is or isn't running.
async function pollForFileContent(
  filePath: string,
  timeoutMs = 5_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      if (content.trim().length > 0) return content
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`${filePath} did not receive content within ${timeoutMs}ms`)
}

function uniqueTempPath(label: string): string {
  return path.join(
    os.tmpdir(),
    `tdr-code-backend-logger-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  )
}

// Builds a real pino instance from buildBackendLoggerOptions(processName)'s
// exact config, redirecting its file target at an isolated temp path so the
// test can read back exactly (and only) what THIS call wrote. Returns the
// logger plus the path to read/clean up.
function buildIsolatedLogger(processName: 'main' | 'bot') {
  const options = buildBackendLoggerOptions(processName)
  const outputPath = uniqueTempPath(processName)
  const logger = pino({
    ...options,
    transport: {
      target: 'pino/file',
      options: { destination: outputPath, mkdir: true },
    },
  })
  return { logger, outputPath }
}

async function readLastLineFrom(
  outputPath: string,
): Promise<Record<string, unknown>> {
  const content = await pollForFileContent(outputPath)
  const lines = content
    .trim()
    .split('\n')
    .filter(line => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
}

function cleanup(outputPath: string) {
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
}

describe('buildBackendLoggerOptions() — real serialized output, not just config shape', () => {
  // A structural check that buildBackendLoggerOptions() sets `redact`/`base`
  // would pass even if the paths were wrong or shaped for the wrong object
  // shape (exactly the mistake frontend-server-logger.ts's header comment
  // warns against reusing REDACT_PATHS for). These tests instead feed real
  // secret-shaped flat objects through an ACTUAL pino instance built from
  // the real config and assert on the bytes pino wrote to disk — the same
  // guarantee a Loki-bound line would carry in production.
  afterEach(() => {
    setNodeEnv('test')
  })

  it('happy path: a warn call writes event, context fields, msg, and base.process as top-level JSON', async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn({ event: 'x', channelId: '123' }, 'msg')

      const line = await readLastLineFrom(outputPath)
      expect(line.event).toBe('x')
      expect(line.channelId).toBe('123')
      expect(line.msg).toBe('msg')
      expect(line.process).toBe('bot')
    } finally {
      cleanup(outputPath)
    }
  })

  it("base.process is 'main' when built with 'main'", async () => {
    const { logger, outputPath } = buildIsolatedLogger('main')
    try {
      logger.warn({ event: 'x' }, 'msg')

      const line = await readLastLineFrom(outputPath)
      expect(line.process).toBe('main')
    } finally {
      cleanup(outputPath)
    }
  })

  it("base.process is 'bot' when built with 'bot' (differs correctly per process)", async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn({ event: 'x' }, 'msg')

      const line = await readLastLineFrom(outputPath)
      expect(line.process).toBe('bot')
    } finally {
      cleanup(outputPath)
    }
  })

  it('redacts a flat privateKey field and the raw sentinel does not survive serialization', async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn(
        { event: 'x', privateKey: 'SENTINEL_PRIVATE_KEY_VALUE' },
        'msg',
      )

      const line = await readLastLineFrom(outputPath)
      expect(line.privateKey).toBe('[Redacted]')
      expect(JSON.stringify(line)).not.toContain('SENTINEL_PRIVATE_KEY_VALUE')
    } finally {
      cleanup(outputPath)
    }
  })

  it('redacts a flat accessToken field and the raw sentinel does not survive serialization', async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn(
        { event: 'x', accessToken: 'SENTINEL_ACCESS_TOKEN_VALUE' },
        'msg',
      )

      const line = await readLastLineFrom(outputPath)
      expect(line.accessToken).toBe('[Redacted]')
      expect(JSON.stringify(line)).not.toContain('SENTINEL_ACCESS_TOKEN_VALUE')
    } finally {
      cleanup(outputPath)
    }
  })

  it('redacts a one-level-nested privateKey field (defense-in-depth for nested call sites)', async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn(
        { event: 'x', git: { privateKey: 'SENTINEL_NESTED_KEY_VALUE' } },
        'msg',
      )

      const line = await readLastLineFrom(outputPath)
      const git = line.git as Record<string, unknown>
      expect(git.privateKey).toBe('[Redacted]')
      expect(JSON.stringify(line)).not.toContain('SENTINEL_NESTED_KEY_VALUE')
    } finally {
      cleanup(outputPath)
    }
  })

  it('redacts the poison-pill env object shape wholesale and the raw sentinel does not survive', async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn(
        { event: 'x', env: { GIT_CONFIG_VALUE_1: 'SENTINEL_ENV_VALUE' } },
        'msg',
      )

      const line = await readLastLineFrom(outputPath)
      expect(line.env).toBe('[Redacted]')
      expect(JSON.stringify(line)).not.toContain('SENTINEL_ENV_VALUE')
    } finally {
      cleanup(outputPath)
    }
  })

  it('redacts the poison-pill GIT_CONFIG_VALUE_1 field when logged as a flat sibling field', async () => {
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.warn(
        { event: 'x', GIT_CONFIG_VALUE_1: 'SENTINEL_GIT_CONFIG_VALUE' },
        'msg',
      )

      const line = await readLastLineFrom(outputPath)
      expect(line.GIT_CONFIG_VALUE_1).toBe('[Redacted]')
      expect(JSON.stringify(line)).not.toContain('SENTINEL_GIT_CONFIG_VALUE')
    } finally {
      cleanup(outputPath)
    }
  })

  it('prod config is file-only at info level: a debug line is dropped, an info line is written', async () => {
    setNodeEnv('production')
    const options = buildBackendLoggerOptions('bot')
    const outputPath = uniqueTempPath('prod')
    const logger = pino({
      ...options,
      transport: {
        target: 'pino/file',
        options: { destination: outputPath, mkdir: true },
      },
    })
    try {
      logger.debug({ event: 'x' }, 'should not be written')
      logger.info({ event: 'y' }, 'should be written')

      const content = await pollForFileContent(outputPath)
      const lines = content
        .trim()
        .split('\n')
        .filter(line => line.trim().length > 0)
      expect(lines).toHaveLength(1)
      const line = JSON.parse(lines[0]) as Record<string, unknown>
      expect(line.msg).toBe('should be written')
      expect(line.event).toBe('y')
    } finally {
      cleanup(outputPath)
    }
  })

  it('dev config honors debug level: a debug line IS written', async () => {
    setNodeEnv('development')
    const { logger, outputPath } = buildIsolatedLogger('bot')
    try {
      logger.debug({ event: 'x' }, 'dev debug line')

      const line = await readLastLineFrom(outputPath)
      expect(line.msg).toBe('dev debug line')
    } finally {
      cleanup(outputPath)
    }
  })
})

// Re-requires backend-logger.ts against the FRESH, un-initialized module
// registry jest.isolateModules creates, since a plain top-level import
// shares the module instance src/__tests__/setup.ts's own
// initBackendLogger('bot') call already ran against — that instance can
// never observe the pre-init state this test needs. A dynamic require()
// (resolved at call time, inside isolateModules's callback) is genuinely
// necessary here rather than a static import (resolved once, before any
// test runs, against Jest's normal shared registry).
function requireFreshBackendLoggerModule(): typeof import('./backend-logger') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./backend-logger')
}

describe('getBackendLogger()', () => {
  it('throws when called before initBackendLogger() has run in this module scope', () => {
    jest.isolateModules(() => {
      const fresh = requireFreshBackendLoggerModule()
      expect(() => fresh.getBackendLogger()).toThrow(
        /getBackendLogger\(\) called before initBackendLogger\(\)/,
      )
    })
  })

  it('returns the process-specific root once initBackendLogger() has run', () => {
    initBackendLogger('bot')
    expect(() => getBackendLogger()).not.toThrow()
  })
})

describe('createLoggerSpy()', () => {
  it('returns a mock whose .info/.warn/.error/.debug are individually assertable via objectContaining on the first (object) argument', () => {
    const spy = createLoggerSpy()

    spy.info({ event: 'a' }, 'info msg')
    spy.warn({ event: 'b' }, 'warn msg')
    spy.error({ event: 'c' }, 'error msg')
    spy.debug({ event: 'd' }, 'debug msg')

    expect(spy.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'a' }),
      expect.any(String),
    )
    expect(spy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'b' }),
      expect.any(String),
    )
    expect(spy.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'c' }),
      expect.any(String),
    )
    expect(spy.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'd' }),
      expect.any(String),
    )
  })
})

// Simulates a future U3-migrated non-DI function: a module-level function
// that calls getBackendLogger() INSIDE its body (never at module-eval time —
// the invariant backend-logger.ts's header comment documents as load-bearing
// for the fail-fast throw to be safe).
function throwawayMigratedFunction(channelId: string): void {
  getBackendLogger().info({ event: 'x', channelId }, 'throwaway log line')
}

describe('integration: a spec reaching a migrated log line does not throw once setup.ts has initialized the logger', () => {
  it('does not throw — proving the backend Jest setup.ts test-init actually prevents the fail-fast crash', () => {
    // Deliberately NOT calling initBackendLogger() in this describe block —
    // the only initialization in scope is src/__tests__/setup.ts's own
    // initBackendLogger('bot') call, which every backend spec file
    // (including this one) inherits automatically. If that test-init line
    // were ever removed, this assertion would start failing with the
    // fail-fast throw instead of passing silently. (This call writes a real
    // line to the real shared logFilePath('backend') — acceptable here
    // since the assertion is only "did not throw", not "read back N
    // lines", so it isn't racing the concurrency hazard the isolated-file
    // tests above exist to avoid.)
    expect(() => throwawayMigratedFunction('999')).not.toThrow()
  })
})

describe('BACKEND_MODULE_REDACT_PATHS', () => {
  it('covers every documented secret-bearing field flat and one level nested', () => {
    const requiredFlat = [
      'privateKey',
      'keyPlaintext',
      'accessToken',
      'refreshToken',
      'cookie',
      'authorization',
      'token',
      'secret',
    ]
    for (const field of requiredFlat) {
      expect(BACKEND_MODULE_REDACT_PATHS).toContain(field)
      expect(BACKEND_MODULE_REDACT_PATHS).toContain(`*.${field}`)
    }
  })

  it('covers every documented poison-pill field flat and one level nested', () => {
    const requiredPoisonPills = [
      'env',
      'signingKey',
      'signing_key',
      'sshCommand',
      'keyPath',
      'GIT_CONFIG_VALUE_1',
    ]
    for (const field of requiredPoisonPills) {
      expect(BACKEND_MODULE_REDACT_PATHS).toContain(field)
      expect(BACKEND_MODULE_REDACT_PATHS).toContain(`*.${field}`)
    }
  })
})
