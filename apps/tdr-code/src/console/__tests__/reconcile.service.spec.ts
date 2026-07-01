import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { ReconcileService } from 'src/console/reconcile.service'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'
import { appendBlock } from 'src/db/turn-content.repo'
import { insertTurn } from 'src/db/turns.repo'

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  } as unknown as PinoLogger
}

function buildService(db: ReturnType<typeof createTestDb>['db']) {
  return new ReconcileService(db, fakeLogger())
}

// Build a real JSONL file path for the given session, rooted under tmpDir.
// Mirrors jsonlPath logic: HOME/.claude/projects/escapedCwd/acpSessionId.jsonl
function makeJsonlPath(
  tmpDir: string,
  cwd: string,
  acpSessionId: string,
): string {
  const escapedCwd = cwd.replace(/[/.]/g, '-')
  return path.join(
    tmpDir,
    '.claude',
    'projects',
    escapedCwd,
    `${acpSessionId}.jsonl`,
  )
}

// Write JSONL content to the path, creating parent dirs as needed.
function writeJsonl(filePath: string, lines: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    'utf8',
  )
}

describe('ReconcileService.getJsonlStatus', () => {
  let testDb: ReturnType<typeof createTestDb>
  let tmpDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    testDb = createTestDb()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-reconcile-'))
    originalHome = process.env.HOME
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    testDb.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
  })

  it('non-existent session → NotFoundException', () => {
    const svc = buildService(testDb.db)
    expect(() => svc.getJsonlStatus(999)).toThrow(NotFoundException)
  })

  it('no acpSessionId → {acpSessionId: null, exists: false, reason: "no-acp-id"}', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: null,
      cwd: '/work',
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = svc.getJsonlStatus(session.id)
    expect(result).toEqual({
      acpSessionId: null,
      exists: false,
      reason: 'no-acp-id',
    })
  })

  it('invalid acpSessionId (contains dot) → locator error propagated', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'bad.session',
      cwd: '/work',
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = svc.getJsonlStatus(session.id)
    expect(result.exists).toBe(false)
    expect(result.reason).toBe('invalid-acp-session-id')
  })

  it('file does not exist → {acpSessionId, exists: false, no reason}', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'valid-session-id',
      cwd: '/work',
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = svc.getJsonlStatus(session.id)
    expect(result.acpSessionId).toBe('valid-session-id')
    expect(result.exists).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('file exists → {acpSessionId, exists: true, no path in response}', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    const jsonlFile = makeJsonlPath(tmpDir, '/work', 'abc123')
    writeJsonl(jsonlFile, [{ type: 'message' }])

    const svc = buildService(testDb.db)
    const result = svc.getJsonlStatus(session.id)
    expect(result.acpSessionId).toBe('abc123')
    expect(result.exists).toBe(true)
    // Must not include the resolved path — security invariant.
    expect(Object.keys(result)).not.toContain('resolvedPath')
    expect(Object.keys(result)).not.toContain('path')
  })
})

describe('ReconcileService.reconcile', () => {
  let testDb: ReturnType<typeof createTestDb>
  let tmpDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    testDb = createTestDb()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-reconcile-'))
    originalHome = process.env.HOME
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    testDb.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
  })

  it('non-existent session → NotFoundException', () => {
    const svc = buildService(testDb.db)
    expect(() => svc.reconcile(999)).toThrow(NotFoundException)
  })

  it('no acpSessionId → cannot-reconcile / no-acp-id', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: null,
      cwd: '/work',
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('cannot-reconcile')
    if (result.verdict === 'cannot-reconcile') {
      expect(result.reason).toBe('no-acp-id')
    }
  })

  it('file missing → cannot-reconcile / file-missing', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('cannot-reconcile')
    if (result.verdict === 'cannot-reconcile') {
      expect(result.reason).toBe('file-missing')
    }
  })

  it('locator error (invalid acpSessionId) → cannot-reconcile', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'bad.session',
      cwd: '/work',
      createdAt: new Date(),
    })
    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('cannot-reconcile')
    if (result.verdict === 'cannot-reconcile') {
      expect(result.reason).toBe('invalid-acp-session-id')
    }
  })

  it('clean match → verdict reconciled, matched > 0, diff arrays empty', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    const turn = insertTurn(testDb.db, {
      sessionId: session.id,
      generationId: gen.id,
      turnIndex: 1,
      userId: 'u1',
      startedAt: new Date(),
    })
    appendBlock(testDb.db, {
      turnId: turn.id,
      kind: 'prompt',
      payload: { kind: 'prompt', text: 'hello' },
      createdAt: new Date(),
    })

    // JSONL record using Claude's nested message format.
    const jsonlFile = makeJsonlPath(tmpDir, '/work', 'abc123')
    writeJsonl(jsonlFile, [
      { type: 'message', message: { role: 'user', content: 'hello' } },
    ])

    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('reconciled')
    if (result.verdict === 'reconciled') {
      expect(result.matched).toBe(1)
      expect(result.missingInDb).toHaveLength(0)
      expect(result.extraInDb).toHaveLength(0)
      expect(result.mismatched).toHaveLength(0)
      expect(result.skippedJsonlLines).toBe(0)
    }
  })

  it('malformed JSONL line → skippedJsonlLines incremented', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    const jsonlFile = makeJsonlPath(tmpDir, '/work', 'abc123')
    fs.mkdirSync(path.dirname(jsonlFile), { recursive: true })
    fs.writeFileSync(jsonlFile, 'not valid json\n{"type":"message"}\n', 'utf8')

    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('reconciled')
    if (result.verdict === 'reconciled') {
      expect(result.skippedJsonlLines).toBe(1)
    }
  })

  it('JSONL longer than DB → missingInDb populated', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    // DB has no blocks (no turns inserted).
    const jsonlFile = makeJsonlPath(tmpDir, '/work', 'abc123')
    writeJsonl(jsonlFile, [
      { type: 'message', message: { role: 'user', content: 'hello' } },
    ])

    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('reconciled')
    if (result.verdict === 'reconciled') {
      expect(result.missingInDb.length).toBeGreaterThan(0)
      expect(result.matched).toBe(0)
    }
  })

  it('DB longer than JSONL → extraInDb populated', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    const turn = insertTurn(testDb.db, {
      sessionId: session.id,
      generationId: gen.id,
      turnIndex: 1,
      userId: 'u1',
      startedAt: new Date(),
    })
    appendBlock(testDb.db, {
      turnId: turn.id,
      kind: 'prompt',
      payload: { kind: 'prompt', text: 'hello' },
      createdAt: new Date(),
    })
    // JSONL is empty.
    const jsonlFile = makeJsonlPath(tmpDir, '/work', 'abc123')
    writeJsonl(jsonlFile, [])

    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('reconciled')
    if (result.verdict === 'reconciled') {
      expect(result.extraInDb.length).toBeGreaterThan(0)
      expect(result.matched).toBe(0)
    }
  })

  it('same-position kind/text divergence → mismatched', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const session = insertSession(testDb.db, {
      channelId: 'ch1',
      generationId: gen.id,
      triggeringUserId: 'u1',
      acpSessionId: 'abc123',
      cwd: '/work',
      createdAt: new Date(),
    })
    const turn = insertTurn(testDb.db, {
      sessionId: session.id,
      generationId: gen.id,
      turnIndex: 1,
      userId: 'u1',
      startedAt: new Date(),
    })
    appendBlock(testDb.db, {
      turnId: turn.id,
      kind: 'prompt',
      payload: { kind: 'prompt', text: 'original' },
      createdAt: new Date(),
    })
    // JSONL has different text at position 0.
    const jsonlFile = makeJsonlPath(tmpDir, '/work', 'abc123')
    writeJsonl(jsonlFile, [
      { type: 'message', message: { role: 'user', content: 'different' } },
    ])

    const svc = buildService(testDb.db)
    const result = svc.reconcile(session.id)
    expect(result.verdict).toBe('reconciled')
    if (result.verdict === 'reconciled') {
      expect(result.mismatched).toHaveLength(1)
      expect(result.matched).toBe(0)
    }
  })
})
