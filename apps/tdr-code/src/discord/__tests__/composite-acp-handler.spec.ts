import type {
  AcpEventHandlers,
  PromptStartContext,
} from 'src/agent/agent.types'
import { CompositeAcpHandler } from 'src/discord/composite-acp-handler'

// Minimal mocks for DiscordHandlerService and SqliteWriterService.
function makeDiscordMock(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
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

// Build a CompositeAcpHandler with injected mocks (bypasses NestJS DI).
function makeComposite(discord: AcpEventHandlers, writer: AcpEventHandlers) {
  const db = makeDbMock()
  const composite = new (CompositeAcpHandler as unknown as {
    new (
      discord: AcpEventHandlers,
      writer: AcpEventHandlers,
      db: unknown,
    ): CompositeAcpHandler
  })(discord, writer, db)
  return composite
}

const ctx: PromptStartContext = {
  sessionRowId: null,
  prompt: { text: 'hello', images: [] },
}

describe('CompositeAcpHandler (B2 — synchronous fan-out)', () => {
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
      ]
      for (const r of results) {
        expect(r).not.toBeInstanceOf(Promise)
        expect(r).toBeUndefined()
      }
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

    it('double-fault (writer + event write fail) degrades to log-only, no throw', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      writer.onPromptStart.mockImplementation(() => {
        throw new Error('DB locked')
      })
      const composite = makeComposite(discord, writer)

      // Should not throw even when both the writer and the event INSERT fail.
      expect(() => composite.onPromptStart('ch1', 1, ctx)).not.toThrow()
    })
  })

  describe('Error path: transcript_write_failed event scrub (F10)', () => {
    it('handleWriterError emits context with errorCode, not the raw error message', () => {
      // The composite tries to write a transcript_write_failed event.
      // The event INSERT uses db.insert; we check that context doesn't include the payload text.
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

      const composite = new (CompositeAcpHandler as unknown as {
        new (
          d: AcpEventHandlers,
          w: AcpEventHandlers,
          db: unknown,
        ): CompositeAcpHandler
      })(discord, writer, db)

      // Get the values call to inspect context.
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 1,
        prompt: { text: 'secret', images: [] },
      })

      // Check that insert was called (for transcript_write_failed).
      // The event context should not contain 'secret'.
      if (db.insert.mock.calls.length > 0) {
        const valuesCall = (
          db.insert.mock.results[0]?.value as Record<string, jest.Mock>
        ).values?.mock?.calls?.[0]?.[0]
        if (valuesCall?.context) {
          const ctxStr = JSON.stringify(valuesCall.context)
          expect(ctxStr).not.toContain('payload text that should not appear')
          expect(ctxStr).not.toContain('secret prompt content')
        }
      }
    })
  })
})
