import { PinoLogger } from 'nestjs-pino'

import { createLoggerSpy, LoggerSpy } from 'src/__tests__/test-utils'
import type {
  AcpEventHandlers,
  PlanApprovalPresenter,
  PromptStartContext,
} from 'src/agent/agent.types'
import { CompositeAcpHandler } from 'src/discord/composite-acp-handler'
import type { NotifyEmitterService } from 'src/discord/notify-emitter.service'
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
function makeDiscordMock(): jest.Mocked<
  AcpEventHandlers & PlanApprovalPresenter
> {
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
    onGitOperationBlocked: jest.fn(),
    presentPlanApproval: jest.fn(),
    settlePlanApprovalUi: jest.fn(),
  }
}

function makeWriterMock(): jest.Mocked<
  AcpEventHandlers & PlanApprovalPresenter
> {
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
    onGitOperationBlocked: jest.fn(),
    presentPlanApproval: jest.fn(),
    settlePlanApprovalUi: jest.fn(),
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
    onGitOperationBlocked: jest.fn(),
  }
}

function makeNotifyEmitterMock(): jest.Mocked<
  Pick<NotifyEmitterService, 'notify'>
> {
  return { notify: jest.fn() }
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
    discord: AcpEventHandlers & PlanApprovalPresenter,
    writer: AcpEventHandlers & PlanApprovalPresenter,
    contextUsage: AcpEventHandlers,
    db: unknown,
    logger: PinoLogger,
    notifyEmitter: Pick<NotifyEmitterService, 'notify'>,
  ): CompositeAcpHandler
}

function makeComposite(
  discord: AcpEventHandlers & PlanApprovalPresenter,
  writer: AcpEventHandlers & PlanApprovalPresenter,
  contextUsage: AcpEventHandlers = makeContextUsageMock(),
  notifyEmitter: Pick<NotifyEmitterService, 'notify'> = makeNotifyEmitterMock(),
) {
  const db = makeDbMock()
  const composite = new (CompositeAcpHandler as unknown as CompositeCtor)(
    discord,
    writer,
    contextUsage,
    db,
    makeLogger(),
    notifyEmitter,
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

    // Covers the plan's "missing-implementer gap" risk: CompositeAcpHandler
    // is a fourth AcpEventHandlers implementer, easy to miss when extending
    // the interface. Invokes onGitOperationBlocked directly on the composite
    // (not through GitTurnContext) and asserts BOTH mocked sub-handlers that
    // this method mirrors onResumeFailed's shape for (discord, writer) were
    // each actually called — not just type-checked. contextUsage is
    // deliberately asserted NOT called: ContextUsageService has no reason to
    // react to a git-block event (same rationale as its existing
    // onResumeFailed no-op), mirroring onResumeFailed's own fan-out shape
    // rather than onUsageUpdate's three-way one.
    it('onGitOperationBlocked forwards to Discord and SQLite handlers, but NOT ContextUsageService (per-turn GitHub enforcement plan, U5)', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const contextUsage = makeContextUsageMock()
      const composite = makeComposite(discord, writer, contextUsage)

      composite.onGitOperationBlocked('ch1', 'github', 'unconfigured')

      expect(discord.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'github',
        'unconfigured',
      )
      expect(writer.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'github',
        'unconfigured',
      )
      expect(contextUsage.onGitOperationBlocked).not.toHaveBeenCalled()
    })

    it('onGitOperationBlocked: a writer fault does not prevent the Discord notice from completing (fault isolation)', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      writer.onGitOperationBlocked.mockImplementation(() => {
        throw new Error('writer fail')
      })
      const composite = makeComposite(discord, writer)

      expect(() =>
        composite.onGitOperationBlocked('ch1', 'ssh', 'decrypt_failed'),
      ).not.toThrow()
      expect(discord.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'ssh',
        'decrypt_failed',
      )
    })

    // Plan-mode support: PlanApprovalPresenter fan-out mirrors
    // onGitOperationBlocked's exact shape (always fan out to both regardless
    // of what either side does with it) — see composite-acp-handler.ts's own
    // comment on why PLAN_APPROVAL_PRESENTER binds here rather than directly
    // to DiscordHandlerService.
    it('presentPlanApproval forwards to both Discord and SQLite handlers', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)

      const req = {
        channelId: 'ch1',
        toolCallId: 'plan-1',
        planText: 'Step 1: do the thing.',
        bypassAvailable: true,
      }
      composite.presentPlanApproval(req)

      expect(discord.presentPlanApproval).toHaveBeenCalledWith(req)
      expect(writer.presentPlanApproval).toHaveBeenCalledWith(req)
    })

    it('settlePlanApprovalUi forwards to both Discord and SQLite handlers, for every outcome', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const composite = makeComposite(discord, writer)

      composite.settlePlanApprovalUi('ch1', 'plan-1', 'accepted')

      expect(discord.settlePlanApprovalUi).toHaveBeenCalledWith(
        'ch1',
        'plan-1',
        'accepted',
      )
      expect(writer.settlePlanApprovalUi).toHaveBeenCalledWith(
        'ch1',
        'plan-1',
        'accepted',
      )
    })

    it('settlePlanApprovalUi: a writer fault does not prevent the Discord message edit from completing (fault isolation)', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      writer.settlePlanApprovalUi.mockImplementation(() => {
        throw new Error('writer fail')
      })
      const composite = makeComposite(discord, writer)

      expect(() =>
        composite.settlePlanApprovalUi('ch1', 'plan-1', 'cancelled'),
      ).not.toThrow()
      expect(discord.settlePlanApprovalUi).toHaveBeenCalledWith(
        'ch1',
        'plan-1',
        'cancelled',
      )
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
        makeNotifyEmitterMock(),
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
        makeNotifyEmitterMock(),
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

  describe('Structured logging (U4): handleWriterError carries event: writer-fault', () => {
    it('logs { event: "writer-fault", err, op, channelId, code } on a writer-side fault', () => {
      const discord = makeDiscordMock()
      const writer = makeWriterMock()
      const db = makeDbMock()
      const loggerSpy: LoggerSpy = createLoggerSpy()
      const err = new Error('write fail')
      writer.onToolCall.mockImplementation(() => {
        throw err
      })

      const composite = new (CompositeAcpHandler as unknown as CompositeCtor)(
        discord,
        writer,
        makeContextUsageMock(),
        db,
        loggerSpy as unknown as PinoLogger,
        makeNotifyEmitterMock(),
      )

      composite.onToolCall('ch1', 'ref1', 'write_file', 'fs', 'pending', [])

      expect(loggerSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'writer-fault',
          err,
          op: 'onToolCall',
          channelId: 'ch1',
        }),
        'Writer fault',
      )
    })
  })

  describe('U3: notify session:<id> after writer success', () => {
    it('onPromptStart seeds the channel->sessionRowId mapping and notifies once', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )

      composite.onPromptStart('ch1', 1, {
        sessionRowId: 42,
        prompt: { text: 'hello', images: [] },
      })

      expect(notifyEmitter.notify).toHaveBeenCalledTimes(1)
      expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:42'])
    })

    it('does not notify when the writer throws (notify is conditioned on success, not unconditional)', () => {
      const writer = makeWriterMock()
      writer.onPromptStart.mockImplementation(() => {
        throw new Error('DB locked')
      })
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        writer,
        makeContextUsageMock(),
        notifyEmitter,
      )

      composite.onPromptStart('ch1', 1, {
        sessionRowId: 42,
        prompt: { text: 'hello', images: [] },
      })

      expect(notifyEmitter.notify).not.toHaveBeenCalled()
    })

    it('INSERT path: onAgentMessageChunk notifies session:<id> once the session row is known (integration, R5)', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()

      composite.onAgentMessageChunk('ch1', 'streaming text')

      expect(notifyEmitter.notify).toHaveBeenCalledTimes(1)
      expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:5'])
    })

    it('INSERT path: a writer throw during onAgentMessageChunk emits no extra notify beyond existing error handling', () => {
      const writer = makeWriterMock()
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        writer,
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()
      writer.onAgentMessageChunk.mockImplementation(() => {
        throw new Error('write fail')
      })

      expect(() =>
        composite.onAgentMessageChunk('ch1', 'streaming text'),
      ).not.toThrow()
      expect(notifyEmitter.notify).not.toHaveBeenCalled()
    })

    it('UPDATE path: onToolCallUpdate (-> updateToolCallStatus) still notifies session:<id> (R5)', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()

      composite.onToolCallUpdate('ch1', 'tool1', 'completed', [])

      expect(notifyEmitter.notify).toHaveBeenCalledTimes(1)
      expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:5'])
    })

    it('UPDATE path: a writer throw during onToolCallUpdate emits no notify', () => {
      const writer = makeWriterMock()
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        writer,
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()
      writer.onToolCallUpdate.mockImplementation(() => {
        throw new Error('write fail')
      })

      expect(() =>
        composite.onToolCallUpdate('ch1', 'tool1', 'completed', []),
      ).not.toThrow()
      expect(notifyEmitter.notify).not.toHaveBeenCalled()
    })

    it('UPDATE path: onPromptComplete (-> closeTurn) notifies session:<id>', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()

      composite.onPromptComplete('ch1', 'end_turn')

      expect(notifyEmitter.notify).toHaveBeenCalledTimes(1)
      expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:5'])
    })

    it('onToolCall (INSERT) notifies session:<id>', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()

      composite.onToolCall('ch1', 'ref1', 'write_file', 'fs', 'pending', [])

      expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:5'])
    })

    it('onAgentMessageImage (INSERT) notifies session:<id>', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()

      composite.onAgentMessageImage('ch1', 'data', 'image/png')

      expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:5'])
    })

    it('does not notify for a channel that never had a successful onPromptStart (no session row known)', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )

      composite.onAgentMessageChunk('ch-unknown', 'text')

      expect(notifyEmitter.notify).not.toHaveBeenCalled()
    })

    it('no-op writer methods (onSessionInfoUpdate/onResumeFailed/onUsageUpdate) never notify — the writer has nothing to change for these', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )
      composite.onPromptStart('ch1', 1, {
        sessionRowId: 5,
        prompt: { text: 'hi', images: [] },
      })
      notifyEmitter.notify.mockClear()

      composite.onSessionInfoUpdate('ch1', 'title')
      composite.onResumeFailed('ch1')
      composite.onUsageUpdate('ch1', 100, 1000)

      expect(notifyEmitter.notify).not.toHaveBeenCalled()
    })

    it('onPromptStart with sessionRowId=null does not seed a mapping — later chokepoints stay silent', () => {
      const notifyEmitter = makeNotifyEmitterMock()
      const composite = makeComposite(
        makeDiscordMock(),
        makeWriterMock(),
        makeContextUsageMock(),
        notifyEmitter,
      )

      composite.onPromptStart('ch1', 1, {
        sessionRowId: null,
        prompt: { text: 'hi', images: [] },
      })
      expect(notifyEmitter.notify).not.toHaveBeenCalled()

      composite.onAgentMessageChunk('ch1', 'text')
      expect(notifyEmitter.notify).not.toHaveBeenCalled()
    })
  })
})
