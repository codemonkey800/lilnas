import { ModuleRef } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ChannelType, Client } from 'discord.js'
import { PinoLogger } from 'nestjs-pino'

import {
  createMockTextChannel,
  createMockThreadChannel,
} from 'src/__tests__/test-utils'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { DB } from 'src/db/database.module'
import * as sessionsRepo from 'src/db/sessions.repo'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb, type TestDb } from 'src/db/test-db'
import { appendBlock } from 'src/db/turn-content.repo'
import { insertTurn } from 'src/db/turns.repo'
import {
  ContextUsageService,
  HANDOFF_POLL_INTERVAL_MS,
  HANDOFF_POLL_TIMEOUT_MS,
} from 'src/discord/context-usage.service'

function createMockClient(channelMap: Map<string, unknown> = new Map()) {
  return {
    channels: { cache: channelMap, fetch: jest.fn() },
  }
}

function createMockSessionManager() {
  return {
    prompt: jest.fn(),
    teardown: jest.fn(),
    cancelPending: jest.fn(),
    isPrompting: jest.fn().mockReturnValue(false),
  }
}

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

async function createService(
  db: TestDb['db'],
  client: ReturnType<typeof createMockClient>,
  sessionManager: ReturnType<typeof createMockSessionManager>,
) {
  const moduleRef = { get: jest.fn().mockReturnValue(sessionManager) }
  const module = await Test.createTestingModule({
    providers: [
      ContextUsageService,
      { provide: Client, useValue: client },
      { provide: ModuleRef, useValue: moduleRef },
      { provide: DB, useValue: db },
      { provide: PinoLogger, useValue: makeLogger() },
    ],
  }).compile()
  return module.get(ContextUsageService)
}

// Polls the microtask queue (capped) until `predicate()` becomes true, rather
// than hardcoding an exact await-hop count through the async handoff chain —
// mirrors session-manager.service.spec.ts's own waitFor helper.
async function waitFor(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve()
  }
}

function sentMessages(
  channel: ReturnType<typeof createMockTextChannel>,
): { content: string }[] {
  return (channel.send as jest.Mock).mock.calls.map(call => call[0])
}

function seedSession(
  db: TestDb['db'],
  genId: number,
  channelId: string,
  triggeringUserId = 'user-1',
) {
  return insertSession(db, {
    channelId,
    generationId: genId,
    triggeringUserId,
    acpSessionId: 'acp-session-1',
    cwd: '/cwd',
    createdAt: new Date(),
  })
}

// Seeds a completed turn with a single agent_text block — simulates the
// handoff-summary turn having already run and persisted its response, the
// same way SqliteWriterService would in production.
function seedSummaryTurn(
  db: TestDb['db'],
  genId: number,
  sessionId: number,
  summaryText: string,
): void {
  const turn = insertTurn(db, {
    sessionId,
    generationId: genId,
    turnIndex: 1,
    userId: null,
    startedAt: new Date(),
  })
  appendBlock(db, {
    turnId: turn.id,
    kind: 'agent_text',
    payload: { kind: 'agent_text', text: summaryText },
    createdAt: new Date(),
  })
}

// Seeds a turn with only its prompt block (no agent_text) — simulates a
// cancelled synthetic summary turn (user hit Stop before any response text
// arrived).
function seedCancelledTurn(
  db: TestDb['db'],
  genId: number,
  sessionId: number,
): void {
  const turn = insertTurn(db, {
    sessionId,
    generationId: genId,
    turnIndex: 1,
    userId: null,
    startedAt: new Date(),
  })
  appendBlock(db, {
    turnId: turn.id,
    kind: 'prompt',
    payload: { kind: 'prompt', text: 'summarize please' },
    createdAt: new Date(),
  })
}

describe('ContextUsageService — threshold notifications', () => {
  it('fires the 25% notice exactly once when crossing from 0% to 30%', async () => {
    const channel = createMockTextChannel()
    const client = createMockClient(new Map([['ch1', channel]]))
    const sessionManager = createMockSessionManager()
    const service = await createService(
      undefined as unknown as TestDb['db'],
      client,
      sessionManager,
    )

    service.onUsageUpdate('ch1', 30, 100)
    await waitFor(() => sentMessages(channel).length > 0)

    expect(channel.send).toHaveBeenCalledTimes(1)
    expect(sentMessages(channel)[0]!.content).toContain('25%')
  })

  it('does not re-fire 25% on a later update that is still under 50%', async () => {
    const channel = createMockTextChannel()
    const client = createMockClient(new Map([['ch1', channel]]))
    const sessionManager = createMockSessionManager()
    const service = await createService(
      undefined as unknown as TestDb['db'],
      client,
      sessionManager,
    )

    service.onUsageUpdate('ch1', 30, 100)
    await waitFor(() => sentMessages(channel).length > 0)
    service.onUsageUpdate('ch1', 40, 100)
    await Promise.resolve()

    expect(channel.send).toHaveBeenCalledTimes(1)
  })

  it('fires 50% after 25% once usage climbs past the next threshold', async () => {
    const channel = createMockTextChannel()
    const client = createMockClient(new Map([['ch1', channel]]))
    const sessionManager = createMockSessionManager()
    const service = await createService(
      undefined as unknown as TestDb['db'],
      client,
      sessionManager,
    )

    service.onUsageUpdate('ch1', 30, 100)
    await waitFor(() => sentMessages(channel).length === 1)
    service.onUsageUpdate('ch1', 60, 100)
    await waitFor(() => sentMessages(channel).length === 2)

    expect(sentMessages(channel)[1]!.content).toContain('50%')
  })

  it('a jump straight to 96% fires only the handoff path, not 25/50/75 in sequence', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      seedSession(db, gen.id, 'ch1')

      const channel = createMockTextChannel()
      const client = createMockClient(new Map([['ch1', channel]]))
      const sessionManager = createMockSessionManager()
      // Abort the handoff immediately via a non-completable outcome so this
      // test only needs to assert what fired *before* the abort, not the
      // full handoff flow.
      sessionManager.prompt.mockResolvedValue({ kind: 'shutting_down' })
      const service = await createService(db, client, sessionManager)

      service.onUsageUpdate('ch1', 96, 100)
      await waitFor(() => sentMessages(channel).length >= 2)

      expect(sentMessages(channel)).toHaveLength(2)
      expect(sentMessages(channel)[0]!.content).toContain('95%')
      expect(sentMessages(channel)[1]!.content).toMatch(/couldn.t generate/i)
    } finally {
      close()
    }
  })

  it('does not start a second handoff while one is already in flight for the same channel', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      seedSession(db, gen.id, 'ch1')

      const channel = createMockTextChannel()
      const client = createMockClient(new Map([['ch1', channel]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt.mockReturnValue(new Promise(() => {})) // never settles
      const service = await createService(db, client, sessionManager)

      service.onUsageUpdate('ch1', 96, 100)
      await waitFor(() => sessionManager.prompt.mock.calls.length > 0)
      service.onUsageUpdate('ch1', 97, 100)
      await Promise.resolve()

      expect(sessionManager.prompt).toHaveBeenCalledTimes(1)
    } finally {
      close()
    }
  })

  it('size <= 0 is a no-op (defensive guard)', async () => {
    const channel = createMockTextChannel()
    const client = createMockClient(new Map([['ch1', channel]]))
    const sessionManager = createMockSessionManager()
    const service = await createService(
      undefined as unknown as TestDb['db'],
      client,
      sessionManager,
    )

    expect(() => service.onUsageUpdate('ch1', 10, 0)).not.toThrow()
  })

  it('onGitOperationBlocked is a no-op: does not throw and sends nothing (ContextUsageService has no reason to react to a git-block event)', async () => {
    const channel = createMockTextChannel()
    const client = createMockClient(new Map([['ch1', channel]]))
    const sessionManager = createMockSessionManager()
    const service = await createService(
      undefined as unknown as TestDb['db'],
      client,
      sessionManager,
    )

    // Called through the AcpEventHandlers interface type (matching how
    // CompositeAcpHandler would invoke it if it ever fanned out here) rather
    // than the concrete class's own narrower (no-params) signature.
    const handlers: import('src/agent/agent.types').AcpEventHandlers = service
    expect(() =>
      handlers.onGitOperationBlocked('ch1', 'github', 'unconfigured'),
    ).not.toThrow()
    expect(channel.send).not.toHaveBeenCalled()
  })

  it('resetChannel clears notifiedThreshold so a later update re-fires the 25% notice', async () => {
    const channel = createMockTextChannel()
    const client = createMockClient(new Map([['ch1', channel]]))
    const sessionManager = createMockSessionManager()
    const service = await createService(
      undefined as unknown as TestDb['db'],
      client,
      sessionManager,
    )

    service.onUsageUpdate('ch1', 30, 100)
    await waitFor(() => sentMessages(channel).length === 1)

    service.resetChannel('ch1')
    service.onUsageUpdate('ch1', 30, 100)
    await waitFor(() => sentMessages(channel).length === 2)

    expect(sentMessages(channel)[1]!.content).toContain('25%')
  })
})

describe('ContextUsageService — runHandoff (95% threshold)', () => {
  afterEach(() => jest.useRealTimers())

  it('polls isPrompting until the queued summary turn settles before reading back the transcript', async () => {
    jest.useFakeTimers()
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = seedSession(db, gen.id, 'ch1')

      const channel = createMockTextChannel({ id: 'ch1' })
      const client = createMockClient(new Map([['ch1', channel]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt
        .mockResolvedValueOnce({ kind: 'queued' }) // summary prompt
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' }) // seed prompt
      sessionManager.isPrompting
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          seedSummaryTurn(db, gen.id, session.id, 'Ship the thing.')
          return false
        })

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('ch1', 96, 100)

      await waitFor(() => sessionManager.prompt.mock.calls.length > 0)
      await waitFor(() => sessionManager.isPrompting.mock.calls.length > 0)
      // Only one poll tick should be needed to flip the mock to settled.
      await jest.advanceTimersByTimeAsync(HANDOFF_POLL_INTERVAL_MS)

      await waitFor(() => sessionManager.teardown.mock.calls.length > 0)
      await waitFor(() => sessionManager.prompt.mock.calls.length >= 2)

      expect(sessionManager.prompt).toHaveBeenLastCalledWith(
        'ch1',
        expect.stringContaining('Ship the thing.'),
        'user-1',
      )
    } finally {
      close()
    }
  })

  it('aborts without tearing down the session when isPrompting never settles within the poll timeout', async () => {
    jest.useFakeTimers()
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      seedSession(db, gen.id, 'ch1')

      const channel = createMockTextChannel({ id: 'ch1' })
      const client = createMockClient(new Map([['ch1', channel]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt.mockResolvedValueOnce({ kind: 'queued' })
      sessionManager.isPrompting.mockReturnValue(true) // always busy

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('ch1', 96, 100)

      await waitFor(() => sessionManager.prompt.mock.calls.length > 0)
      await jest.advanceTimersByTimeAsync(
        HANDOFF_POLL_TIMEOUT_MS + HANDOFF_POLL_INTERVAL_MS,
      )

      await waitFor(() =>
        sentMessages(channel).some(m => /taking too long/i.test(m.content)),
      )

      expect(sessionManager.teardown).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('aborts without tearing down when the summary turn produced no agent_text (e.g. cancelled)', async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = seedSession(db, gen.id, 'ch1')
      seedCancelledTurn(db, gen.id, session.id)

      const channel = createMockTextChannel({ id: 'ch1' })
      const client = createMockClient(new Map([['ch1', channel]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt.mockResolvedValueOnce({
        kind: 'completed',
        stopReason: 'cancelled',
      })

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('ch1', 96, 100)

      await waitFor(() =>
        sentMessages(channel).some(m => /came back empty/i.test(m.content)),
      )

      expect(sessionManager.teardown).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('creates a sibling thread and does not clear the ACP session id when the old channel has a threadable parent', async () => {
    const { db, close } = createTestDb()
    const clearAcpSpy = jest.spyOn(sessionsRepo, 'clearAcpSessionId')
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = seedSession(db, gen.id, 'thread-1')
      seedSummaryTurn(db, gen.id, session.id, 'Summary text here.')

      const newThread = { id: 'new-thread-1' }
      const parentChannel = {
        type: ChannelType.GuildText,
        threads: { create: jest.fn().mockResolvedValue(newThread) },
      }
      const oldThread = createMockThreadChannel({
        id: 'thread-1',
        name: 'old-thread',
        parent: parentChannel,
      })
      const client = createMockClient(new Map([['thread-1', oldThread]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' })
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' })

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('thread-1', 96, 100)

      await waitFor(() => parentChannel.threads.create.mock.calls.length > 0)
      await waitFor(() => sessionManager.prompt.mock.calls.length >= 2)

      expect(parentChannel.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining('old-thread'),
        }),
      )
      expect(sessionManager.teardown).toHaveBeenCalledWith(
        'thread-1',
        'teardown',
        {
          reason: 'context_limit',
        },
      )
      expect(clearAcpSpy).not.toHaveBeenCalled()
      expect(sessionManager.prompt).toHaveBeenLastCalledWith(
        'new-thread-1',
        expect.stringContaining('Summary text here.'),
        'user-1',
      )
    } finally {
      clearAcpSpy.mockRestore()
      close()
    }
  })

  it('falls back to inline continuation and clears the ACP session id when the old channel is not a thread', async () => {
    const { db, close } = createTestDb()
    const clearAcpSpy = jest.spyOn(sessionsRepo, 'clearAcpSessionId')
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = seedSession(db, gen.id, 'ch-inline')
      seedSummaryTurn(db, gen.id, session.id, 'Inline summary.')

      const channel = createMockTextChannel({ id: 'ch-inline' })
      const client = createMockClient(new Map([['ch-inline', channel]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' })
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' })

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('ch-inline', 96, 100)

      await waitFor(() => clearAcpSpy.mock.calls.length > 0)
      await waitFor(() => sessionManager.prompt.mock.calls.length >= 2)

      expect(clearAcpSpy).toHaveBeenCalledWith(db, 'ch-inline')
      expect(sessionManager.teardown).toHaveBeenCalledWith(
        'ch-inline',
        'teardown',
        {
          reason: 'context_limit',
        },
      )
      expect(sessionManager.prompt).toHaveBeenLastCalledWith(
        'ch-inline',
        expect.stringContaining('Inline summary.'),
        'user-1',
      )
    } finally {
      clearAcpSpy.mockRestore()
      close()
    }
  })

  it('falls back to inline (and still clears the ACP session id) when thread creation throws', async () => {
    const { db, close } = createTestDb()
    const clearAcpSpy = jest.spyOn(sessionsRepo, 'clearAcpSessionId')
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = seedSession(db, gen.id, 'thread-2')
      seedSummaryTurn(db, gen.id, session.id, 'Fallback summary.')

      const parentChannel = {
        type: ChannelType.GuildText,
        threads: {
          create: jest.fn().mockRejectedValue(new Error('Missing Permissions')),
        },
      }
      const oldThread = createMockThreadChannel({
        id: 'thread-2',
        name: 'old-thread-2',
        parent: parentChannel,
      })
      const client = createMockClient(new Map([['thread-2', oldThread]]))
      const sessionManager = createMockSessionManager()
      sessionManager.prompt
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' })
        .mockResolvedValueOnce({ kind: 'completed', stopReason: 'end_turn' })

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('thread-2', 96, 100)

      await waitFor(() => clearAcpSpy.mock.calls.length > 0)
      await waitFor(() => sessionManager.prompt.mock.calls.length >= 2)

      expect(clearAcpSpy).toHaveBeenCalledWith(db, 'thread-2')
      expect(sessionManager.prompt).toHaveBeenLastCalledWith(
        'thread-2',
        expect.stringContaining('Fallback summary.'),
        'user-1',
      )
    } finally {
      clearAcpSpy.mockRestore()
      close()
    }
  })

  it("tears down the old session strictly before issuing the new session's first prompt", async () => {
    const { db, close } = createTestDb()
    try {
      const gen = insertGeneration(db, { startedAt: new Date() })
      const session = seedSession(db, gen.id, 'ch-order')
      seedSummaryTurn(db, gen.id, session.id, 'Ordering summary.')

      const channel = createMockTextChannel({ id: 'ch-order' })
      const client = createMockClient(new Map([['ch-order', channel]]))
      const sessionManager = createMockSessionManager()
      const callOrder: string[] = []
      sessionManager.teardown.mockImplementation(() => {
        callOrder.push('teardown')
      })
      sessionManager.prompt.mockImplementation(() => {
        if (sessionManager.prompt.mock.calls.length > 1)
          callOrder.push('seed-prompt')
        return Promise.resolve({ kind: 'completed', stopReason: 'end_turn' })
      })

      const service = await createService(db, client, sessionManager)
      service.onUsageUpdate('ch-order', 96, 100)

      await waitFor(() => callOrder.includes('seed-prompt'))

      expect(callOrder).toEqual(['teardown', 'seed-prompt'])
    } finally {
      close()
    }
  })
})
