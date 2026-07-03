import { PinoLogger } from 'nestjs-pino'

import type {
  AcpEventHandlers,
  PromptStartContext,
} from 'src/agent/agent.types'
import { CompositeAcpHandler } from 'src/discord/composite-acp-handler'
import { EnvKeys } from 'src/env'

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

// Minimal mocks for DiscordHandlerService, SqliteWriterService, and
// ContextUsageService.
function makeDiscordMock(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onSessionInfoUpdate: jest.fn(),
    onResumeFailed: jest.fn(),
    onUsageUpdate: jest.fn(),
  }
}

function makeWriterMock(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onSessionInfoUpdate: jest.fn(),
    onResumeFailed: jest.fn(),
    onUsageUpdate: jest.fn(),
  }
}

function makeContextUsageMock(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onSessionInfoUpdate: jest.fn(),
    onResumeFailed: jest.fn(),
    onUsageUpdate: jest.fn(),
  }
}

function makeDbMock() {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    from: jest.fn(),
    get: jest.fn().mockReturnValue({ id: 1 }),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: 0 }),
  }
  for (const k of [
    'values',
    'set',
    'where',
    'returning',
    'orderBy',
    'limit',
    'onConflictDoUpdate',
    'from',
  ]) {
    chain[k]!.mockReturnValue(chain)
  }
  return {
    insert: jest.fn().mockReturnValue(chain),
    update: jest.fn().mockReturnValue(chain),
    select: jest.fn().mockReturnValue(chain),
    delete: jest.fn().mockReturnValue(chain),
  }
}

type CompositeCtor = {
  new (
    discord: AcpEventHandlers,
    writer: AcpEventHandlers,
    contextUsage: AcpEventHandlers,
    db: unknown,
    logger: PinoLogger,
  ): CompositeAcpHandler
}

function makeComposite(
  discord: AcpEventHandlers,
  writer: AcpEventHandlers,
  contextUsage: AcpEventHandlers = makeContextUsageMock(),
) {
  const db = makeDbMock()
  const composite = new (CompositeAcpHandler as unknown as CompositeCtor)(
    discord,
    writer,
    contextUsage,
    db,
    makeLogger(),
  )
  return composite
}

const ctx: PromptStartContext = {
  sessionRowId: null,
  prompt: { text: 'hello', images: [] },
}

describe('CompositeAcpHandler (B2 — synchronous fan-out)', () => {
  // Set generationId so handleWriterError reaches insertEvent in all error-path tests.
  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  describe('Happy path: fan-out dispatches to both children in Discord-first order', () => {
    it('onToolCall calls discord then writer synchronously', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)

      const callOrder: string[] = []
      discord.onToolCall.mockImplementation(() => {
        callOrder.push('discord')
      })
      writer.onToolCall.mockImplementation(() => {
        callOrder.push('writer')
      })

      composite.onToolCall('ch1', 'ref1', 'write_file', 'fs', 'pending', [])
      expect(callOrder).toEqual(['discord', 'writer'])
      expect(discord.onToolCall).toHaveBeenCalledTimes(1)
      expect(writer.onToolCall).toHaveBeenCalledTimes(1)
    })

    it('onPromptStart calls discord then writer synchronously', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)
      composite.onPromptStart('ch1', 1, ctx)
      expect(discord.onPromptStart).toHaveBeenCalledWith('ch1', 1, ctx)
      expect(writer.onPromptStart).toHaveBeenCalledWith('ch1', 1, ctx)
    })

    it('onPromptComplete calls discord then writer synchronously', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)
      composite.onPromptComplete('ch1', 'end_turn')
      expect(discord.onPromptComplete).toHaveBeenCalledWith('ch1', 'end_turn')
      expect(writer.onPromptComplete).toHaveBeenCalledWith('ch1', 'end_turn')
    })

    it('no method returns a Promise (synchronous invariant, Decision 1)', () => {
      const composite = makeComposite(makeDiscordMock(), makeWriterMock())
      const results = [
        composite.onToolCall('ch', 'r', 't', 'fs', 'pending', []),
        composite.onToolCallUpdate('ch', 'r', 'completed', []),
        composite.onAgentMessageChunk('ch', 'text'),
        composite.onAgentMessageImage('ch', 'data', 'image/png'),
        composite.onPromptStart('ch', 1, ctx),
        composite.onPromptComplete('ch', 'end_turn'),
        composite.onSessionInfoUpdate('ch', 'title'),
        composite.onResumeFailed('ch'),
        composite.onUsageUpdate('ch', 100, 1000),
      ]
      for (const r of results) {
        expect(r).not.toBeInstanceOf(Promise)
        expect(r).toBeUndefined()
      }
    })

    it('onSessionInfoUpdate forwards to both Discord and SQLite handlers (U3)', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)

      composite.onSessionInfoUpdate('ch1', 'Refactor auth module')

      expect(discord.onSessionInfoUpdate).toHaveBeenCalledWith(
        'ch1',
        'Refactor auth module',
      )
      expect(writer.onSessionInfoUpdate).toHaveBeenCalledWith(
        'ch1',
        'Refactor auth module',
      )
    })

    it('onToolCallUpdate forwards the resolved rawInput/title to both Discord and SQLite handlers', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)

      composite.onToolCallUpdate(
        'ch1',
        'tool1',
        'in_progress',
        [],
        { command: 'git status' },
        'git status',
      )

      expect(discord.onToolCallUpdate).toHaveBeenCalledWith(
        'ch1',
        'tool1',
        'in_progress',
        [],
        { command: 'git status' },
        'git status',
      )
      expect(writer.onToolCallUpdate).toHaveBeenCalledWith(
        'ch1',
        'tool1',
        'in_progress',
        [],
        { command: 'git status' },
        'git status',
      )
    })

    it('onResumeFailed forwards to both Discord and SQLite handlers (U5)', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)

      composite.onResumeFailed('ch1')

      expect(discord.onResumeFailed).toHaveBeenCalledWith('ch1')
      expect(writer.onResumeFailed).toHaveBeenCalledWith('ch1')
    })

    it('onUsageUpdate forwards to Discord, writer, and ContextUsageService', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const contextUsage = makeContextUsageMock()
      const composite = makeComposite(discord, writer, contextUsage)

      composite.onUsageUpdate('ch1', 15000, 200000)

      expect(discord.onUsageUpdate).toHaveBeenCalledWith('ch1', 15000, 200000)
      expect(writer.onUsageUpdate).toHaveBeenCalledWith('ch1', 15000, 200000)
      expect(contextUsage.onUsageUpdate).toHaveBeenCalledWith(
        'ch1',
        15000,
        200000,
      )
    })
  })

  describe('Error path (Decision 2): fault isolation', () => {
    it('writer fault does NOT prevent Discord handler from completing', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      writer.onAgentMessageChunk.mockImplementation(() => {
        throw new Error('write fail')
      })
      const composite = makeComposite(discord, writer)

      expect(() => composite.onAgentMessageChunk('ch1', 'text')).not.toThrow()
      expect(discord.onAgentMessageChunk).toHaveBeenCalledWith('ch1', 'text')
    })

    it('Discord fault does NOT prevent writer from running (mirror invariant)', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      discord.onAgentMessageChunk.mockImplementation(() => {
        throw new Error('discord fail')
      })
      const composite = makeComposite(discord, writer)

      expect(() => composite.onAgentMessageChunk('ch1', 'text')).not.toThrow()
      expect(writer.onAgentMessageChunk).toHaveBeenCalledWith('ch1', 'text')
    })

    it('a ContextUsageService fault does NOT prevent Discord or writer from running', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const contextUsage = makeContextUsageMock()
      contextUsage.onUsageUpdate.mockImplementation(() => {
        throw new Error('context-usage fail')
      })
      const composite = makeComposite(discord, writer, contextUsage)

      expect(() => composite.onUsageUpdate('ch1', 15000, 200000)).not.toThrow()
      expect(discord.onUsageUpdate).toHaveBeenCalledWith('ch1', 15000, 200000)
      expect(writer.onUsageUpdate).toHaveBeenCalledWith('ch1', 15000, 200000)
    })

    it('double-fault (writer throw + event INSERT throw) degrades to log-only, no rethrow', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      writer.onPromptStart.mockImplementation(() => {
        throw new Error('DB locked')
      })
      const db = makeDbMock()
      // Make the inner insertEvent also throw to exercise the double-fault catch.
      db.insert.mockImplementation(() => {
        throw new Error('also locked')
      })
      const composite = new (CompositeAcpHandler as unknown as CompositeCtor)(
        discord,
        writer,
        makeContextUsageMock(),
        db,
        makeLogger(),
      )

      expect(() => composite.onPromptStart('ch1', 1, ctx)).not.toThrow()
    })
  })

  describe('Error path: transcript_write_failed event scrub (F10)', () => {
    it('handleWriterError emits context with errorCode, not the raw error message', () => {
      expect.assertions(3)

      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const db = makeDbMock()
      writer.onPromptStart.mockImplementation(() => {
        const err = new Error(
          'payload text that should not appear in context: secret prompt content',
        )
        err.name = 'SqliteError'
        throw err
      })

      const composite = new (CompositeAcpHandler as unknown as CompositeCtor)(
        discord,
        writer,
        makeContextUsageMock(),
        db,
        makeLogger(),
      )

      composite.onPromptStart('ch1', 1, {
        sessionRowId: 1,
        prompt: { text: 'secret', images: [] },
      })

      expect(db.insert).toHaveBeenCalled()
      const valuesCall = (
        db.insert.mock.results[0]?.value as Record<string, jest.Mock>
      ).values?.mock?.calls?.[0]?.[0]
      const ctxStr = JSON.stringify(valuesCall.context)
      expect(ctxStr).not.toContain('payload text that should not appear')
      expect(ctxStr).not.toContain('secret prompt content')
    })
  })
})
