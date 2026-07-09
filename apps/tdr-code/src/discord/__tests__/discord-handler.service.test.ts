import { ModuleRef } from '@nestjs/core'
import { Client } from 'discord.js'
import { PinoLogger } from 'nestjs-pino'

import {
  createMockMessage,
  createMockTextChannel,
  createTestingModule,
} from 'src/__tests__/test-utils'
import {
  DiscordHandlerService,
  WORKING_MESSAGES,
} from 'src/discord/discord-handler.service'
import { stopButtonId } from 'src/discord/stop-button-id'

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

function createMockClient() {
  return {
    user: { id: 'bot-id' },
    channels: {
      cache: new Map(),
      fetch: jest.fn(),
    },
  }
}

function createMockModuleRef() {
  return {
    get: jest.fn(),
  }
}

async function createService(clientOverrides = {}) {
  const mockClient = { ...createMockClient(), ...clientOverrides }
  const mockModuleRef = createMockModuleRef()

  const module = await createTestingModule([
    DiscordHandlerService,
    { provide: Client, useValue: mockClient },
    { provide: ModuleRef, useValue: mockModuleRef },
    { provide: PinoLogger, useValue: makeLogger() },
  ])

  const service = module.get(DiscordHandlerService)
  return { service, mockClient, mockModuleRef }
}

function channelStates(service: DiscordHandlerService): Map<string, unknown> {
  return (service as unknown as { channelStates: Map<string, unknown> })
    .channelStates
}

function clearedTurnId(service: DiscordHandlerService): Map<string, number> {
  return (service as unknown as { clearedTurnId: Map<string, number> })
    .clearedTurnId
}

describe('DiscordHandlerService — onPromptStart', () => {
  it('posts a working message with a Stop button encoding channelId and turnId', async () => {
    const workingMsg = createMockMessage({ id: 'working-1' })
    const channel = createMockTextChannel({
      send: jest.fn().mockResolvedValue(workingMsg),
    })
    const mockClient = {
      ...createMockClient(),
      channels: { cache: new Map([['ch1', channel]]), fetch: jest.fn() },
    }
    const { service } = await createService(mockClient)

    service.onPromptStart('ch1', 7, {
      sessionRowId: null,
      prompt: { text: '', images: [] },
    })
    await new Promise(r => setImmediate(r))

    expect(channel.send).toHaveBeenCalledTimes(1)
    const call = (channel.send as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(WORKING_MESSAGES).toContain(call.content)
    expect(call.components).toBeDefined()
  })

  it('posts working message even when no onToolCall fires (R15 / AE4)', async () => {
    const workingMsg = createMockMessage({ id: 'working-2' })
    const channel = createMockTextChannel({
      send: jest.fn().mockResolvedValue(workingMsg),
    })
    const mockClient = {
      ...createMockClient(),
      channels: { cache: new Map([['ch1', channel]]), fetch: jest.fn() },
    }
    const { service } = await createService(mockClient)

    service.onPromptStart('ch1', 1, {
      sessionRowId: null,
      prompt: { text: '', images: [] },
    })
    await new Promise(r => setImmediate(r))

    const states = channelStates(service)
    const state = states.get('ch1') as Record<string, unknown> | undefined

    // workingMessage exists independently of toolSummaryMessage
    expect(state?.workingMessage).toBeDefined()
    expect(state?.toolSummaryMessage).toBeNull()
  })

  it('CustomId in Stop button encodes channelId and turnId', async () => {
    const { ButtonBuilder } = jest.requireMock('discord.js') as {
      ButtonBuilder: jest.Mock
    }
    const setCustomId = jest.fn().mockReturnThis()
    const setLabel = jest.fn().mockReturnThis()
    const setStyle = jest.fn().mockReturnThis()
    ButtonBuilder.mockImplementation(() => ({
      setCustomId,
      setLabel,
      setStyle,
    }))

    const workingMsg = createMockMessage({ id: 'working-3' })
    const channel = createMockTextChannel({
      send: jest.fn().mockResolvedValue(workingMsg),
    })
    const mockClient = {
      ...createMockClient(),
      channels: { cache: new Map([['ch-123', channel]]), fetch: jest.fn() },
    }
    const { service } = await createService(mockClient)

    service.onPromptStart('ch-123', 42, {
      sessionRowId: null,
      prompt: { text: '', images: [] },
    })
    await new Promise(r => setImmediate(r))

    expect(setCustomId).toHaveBeenCalledWith(stopButtonId('ch-123', 42))
  })
})

describe('DiscordHandlerService — onPromptComplete / finalizeTurn', () => {
  it('deletes working message on normal completion (R7)', async () => {
    const workingMsg = createMockMessage({ id: 'w1' })
    const channel = createMockTextChannel()
    const mockClient = {
      ...createMockClient(),
      channels: { cache: new Map([['ch1', channel]]), fetch: jest.fn() },
    }
    const { service } = await createService(mockClient)

    const states = channelStates(service)
    states.set('ch1', {
      toolStates: new Map(),
      toolSummaryMessage: null,
      toolSummaryCreating: false,
      pendingDiffs: new Map(),
      replyBuffer: '',
      replyMessage: null,
      flushTimer: null,
      workingMessage: workingMsg,
      workingMessageCreating: false,
      currentTurnId: 1,
    })

    service.onPromptComplete('ch1', 'end_turn')
    await new Promise(r => setImmediate(r))

    expect(workingMsg.delete).toHaveBeenCalled()
  })

  it('edits working message to "⚠ Error" on error path (R7)', async () => {
    const workingMsg = createMockMessage({ id: 'w2' })
    const { service } = await createService()

    const states = channelStates(service)
    states.set('ch1', {
      toolStates: new Map(),
      toolSummaryMessage: null,
      toolSummaryCreating: false,
      pendingDiffs: new Map(),
      replyBuffer: '',
      replyMessage: null,
      flushTimer: null,
      workingMessage: workingMsg,
      workingMessageCreating: false,
      currentTurnId: 1,
    })

    service.onPromptComplete('ch1', 'error')
    await new Promise(r => setImmediate(r))

    expect(workingMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠ Error', components: [] }),
    )
  })

  it('edits working message to "⏹ Stopped" and keeps partial reply on cancel (R6, AE2)', async () => {
    const workingMsg = createMockMessage({ id: 'w3' })
    const partialContent = 'partial output here'
    const channel = createMockTextChannel({
      send: jest.fn().mockResolvedValue(createMockMessage()),
    })
    const mockClient = {
      ...createMockClient(),
      channels: { cache: new Map([['ch1', channel]]), fetch: jest.fn() },
    }
    const { service } = await createService(mockClient)

    const states = channelStates(service)
    states.set('ch1', {
      toolStates: new Map(),
      toolSummaryMessage: null,
      toolSummaryCreating: false,
      pendingDiffs: new Map(),
      replyBuffer: partialContent,
      replyMessage: null,
      flushTimer: null,
      workingMessage: workingMsg,
      workingMessageCreating: false,
      currentTurnId: 1,
    })

    service.onPromptComplete('ch1', 'cancelled')
    await new Promise(r => setImmediate(r))

    expect(workingMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⏹ Stopped', components: [] }),
    )
    // Partial reply must still be sent (R6)
    expect(channel.send).toHaveBeenCalledWith(partialContent)
  })

  it('stopReason flows executePrompt → onPromptComplete → finalizeTurn (integration)', async () => {
    const workingMsg = createMockMessage({ id: 'w4' })
    const { service } = await createService()

    const states = channelStates(service)
    states.set('ch1', {
      toolStates: new Map(),
      toolSummaryMessage: null,
      toolSummaryCreating: false,
      pendingDiffs: new Map(),
      replyBuffer: '',
      replyMessage: null,
      flushTimer: null,
      workingMessage: workingMsg,
      workingMessageCreating: false,
      currentTurnId: 1,
    })

    service.onPromptComplete('ch1', 'max_tokens')
    await new Promise(r => setImmediate(r))

    // Normal completion (non-cancelled, non-error) → delete
    expect(workingMsg.delete).toHaveBeenCalled()
  })
})

describe('DiscordHandlerService — onToolCallUpdate resolves the placeholder title/rawInput', () => {
  // Regression: Bash/Read/etc. tool calls arrive via onToolCall while the SDK
  // is still streaming input, so rawInput is `{}` and title falls back to a
  // generic label (e.g. "Terminal"). A later onToolCallUpdate carries the
  // resolved command/file path — it must overwrite that first snapshot
  // instead of being dropped because a (truthy but empty) rawInput already
  // existed.
  it('replaces the empty placeholder rawInput with the resolved command', async () => {
    const { service } = await createService()

    service.onToolCall('ch1', 'tool1', 'Terminal', 'execute', 'pending', [], {})
    service.onToolCallUpdate(
      'ch1',
      'tool1',
      'in_progress',
      [],
      { command: 'git status' },
      'git status',
    )

    const state = channelStates(service).get('ch1') as
      | { toolStates: Map<string, { title: string; rawInput?: unknown }> }
      | undefined
    const tool = state?.toolStates.get('tool1')

    expect(tool?.rawInput).toEqual({ command: 'git status' })
    expect(tool?.title).toBe('git status')
  })

  it('leaves the existing rawInput/title untouched when the update carries neither', async () => {
    const { service } = await createService()

    service.onToolCall('ch1', 'tool1', 'Terminal', 'execute', 'pending', [], {
      command: 'git status',
    })
    service.onToolCallUpdate('ch1', 'tool1', 'completed', [])

    const state = channelStates(service).get('ch1') as
      | { toolStates: Map<string, { title: string; rawInput?: unknown }> }
      | undefined
    const tool = state?.toolStates.get('tool1')

    expect(tool?.rawInput).toEqual({ command: 'git status' })
    expect(tool?.title).toBe('Terminal')
  })
})

describe('DiscordHandlerService — resetChannel', () => {
  it('clears channel state and sets cleared-channel guard', async () => {
    const workingMsg = createMockMessage({ id: 'w5' })
    const { service } = await createService()

    const states = channelStates(service)
    states.set('ch1', {
      toolStates: new Map(),
      toolSummaryMessage: null,
      toolSummaryCreating: false,
      pendingDiffs: new Map(),
      replyBuffer: '',
      replyMessage: null,
      flushTimer: null,
      workingMessage: workingMsg,
      workingMessageCreating: false,
      currentTurnId: 1,
    })

    service.resetChannel('ch1')

    expect(states.has('ch1')).toBe(false)
    // Watermark is set to the cleared turn's id
    const guard = clearedTurnId(service)
    expect(guard.has('ch1')).toBe(true)
    expect(guard.get('ch1')).toBe(1)
  })

  it('late ACP chunk after resetChannel does not resurrect channelStates (late event guard)', async () => {
    const { service } = await createService()

    service.resetChannel('ch1')
    // Simulate a late ACP event
    service.onAgentMessageChunk('ch1', 'orphaned text')

    const states = channelStates(service)
    expect(states.has('ch1')).toBe(false)
  })

  it('post-clear onPromptComplete finds no state and posts nothing', async () => {
    const { service } = await createService()

    service.resetChannel('ch1')
    // Should be a no-op — no state found
    service.onPromptComplete('ch1', 'error')

    const states = channelStates(service)
    expect(states.has('ch1')).toBe(false)
  })
})

describe('DiscordHandlerService — race: fast turn before working message send resolves', () => {
  it('deletes orphaned working message if turn already finalized before send completes', async () => {
    const workingMsg = createMockMessage({ id: 'w-race' })

    let resolveSend: (msg: unknown) => void
    const sendPromise = new Promise(r => {
      resolveSend = r
    })

    const channel = createMockTextChannel({
      send: jest.fn().mockReturnValue(sendPromise),
    })
    const mockClient = {
      ...createMockClient(),
      channels: { cache: new Map([['ch-race', channel]]), fetch: jest.fn() },
    }
    const { service } = await createService(mockClient)

    service.onPromptStart('ch-race', 1, {
      sessionRowId: null,
      prompt: { text: '', images: [] },
    })
    // Finalize the turn before send resolves
    service.onPromptComplete('ch-race', 'end_turn')

    // Now resolve send with a message
    resolveSend!(workingMsg)
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    // State was deleted — orphaned message must be deleted, not left as "🔄 Working…"
    expect(workingMsg.delete).toHaveBeenCalled()
  })
})
