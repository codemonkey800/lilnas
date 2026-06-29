import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { ClientSideConnection } from '@agentclientprotocol/sdk'
import { Test } from '@nestjs/testing'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'
import * as claudeProcessRepo from 'src/db/claude-process.repo'
import { DB } from 'src/db/database.module'
import { EnvKeys } from 'src/env'

interface TestSession {
  channelId: string
  process: unknown
  connection: TestConnection
  sessionId: string
  lastActivity: number
  idleTimer: NodeJS.Timeout
  prompting: boolean
  imageCapable: boolean
  currentTurnId: number
  queue: Array<{ text: string; userId: string; images: never[] }>
  activeUserId: string
}

interface TestConnection {
  prompt: jest.Mock
  cancel: jest.Mock
  initialize: jest.Mock
  newSession: jest.Mock
}

interface ServiceInternals {
  sessions: Map<string, TestSession>
  executePrompt: (
    session: TestSession,
    text: string,
    userId: string,
    images?: never[],
  ) => Promise<string>
}

function createMockHandlers(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
  }
}

function createMockConnection(stopReason = 'end_turn'): TestConnection {
  return {
    prompt: jest.fn().mockResolvedValue({ stopReason }),
    cancel: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn().mockResolvedValue(undefined),
    newSession: jest.fn().mockResolvedValue({ sessionId: 'session-1' }),
  }
}

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}))

jest.mock('@agentclientprotocol/sdk', () => ({
  ndJsonStream: jest.fn().mockReturnValue({}),
  PROTOCOL_VERSION: '1.0',
  ClientSideConnection: jest.fn(),
}))

jest.mock('src/agent/acp-client', () => ({
  createAcpClient: jest.fn(),
}))

async function createService(handlers: AcpEventHandlers) {
  const module = await Test.createTestingModule({
    providers: [
      SessionManagerService,
      { provide: ACP_EVENT_HANDLERS, useValue: handlers },
      {
        provide: DB,
        useValue: { insert: jest.fn(), update: jest.fn(), select: jest.fn() },
      },
    ],
  }).compile()
  return module.get(SessionManagerService)
}

function internals(service: SessionManagerService): ServiceInternals {
  return service as unknown as ServiceInternals
}

function injectSession(
  service: SessionManagerService,
  channelId: string,
  connection: TestConnection,
): TestSession {
  const mockProc = {
    pid: 1234,
    stdin: { write: jest.fn() },
    stdout: { pipe: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
  }

  const session: TestSession = {
    channelId,
    process: mockProc,
    connection,
    sessionId: 'session-1',
    lastActivity: Date.now(),
    idleTimer: setTimeout(() => {}, 99999),
    prompting: false,
    imageCapable: false,
    currentTurnId: 0,
    queue: [],
    activeUserId: 'user-1',
  }

  internals(service).sessions.set(channelId, session)
  return session
}

describe('SessionManagerService', () => {
  describe('turn id minting', () => {
    it('calls onPromptStart with a fresh turn id before the prompt resolves', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      let startCalledBeforeResolve = false
      connection.prompt.mockImplementationOnce(async () => {
        startCalledBeforeResolve = handlers.onPromptStart.mock.calls.length > 0
        return { stopReason: 'end_turn' }
      })

      await internals(service).executePrompt(session, 'hello', 'user-1')

      expect(handlers.onPromptStart).toHaveBeenCalledTimes(1)
      expect(handlers.onPromptStart).toHaveBeenCalledWith('ch1', 1)
      expect(startCalledBeforeResolve).toBe(true)
    })

    it('mints a fresh turn id per queued drain (every turn gets onPromptStart)', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      await internals(service).executePrompt(session, 'first', 'user-1')
      await internals(service).executePrompt(session, 'second', 'user-1')

      expect(handlers.onPromptStart).toHaveBeenCalledTimes(2)
      const ids = handlers.onPromptStart.mock.calls.map(c => c[1] as number)
      expect(ids[0]).toBeLessThan(ids[1])
      expect(new Set(ids).size).toBe(2)
    })
  })

  describe('cancel()', () => {
    it('clears queue and calls connection.cancel, returns true on matching turn', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      session.prompting = true
      session.currentTurnId = 5
      session.queue = [{ text: 'queued', userId: 'user-1', images: [] }]

      const result = service.cancel('ch1', 5)

      expect(result).toBe(true)
      expect(session.queue).toHaveLength(0)
      expect(connection.cancel).toHaveBeenCalled()
    })

    it('returns false and does nothing for a stale turn id', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      session.prompting = true
      session.currentTurnId = 5
      session.queue = [{ text: 'queued', userId: 'user-1', images: [] }]

      const result = service.cancel('ch1', 3)

      expect(result).toBe(false)
      expect(session.queue).toHaveLength(1)
      expect(connection.cancel).not.toHaveBeenCalled()
    })

    it('returns false when not prompting (C2 short-circuit before turn-id check)', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      session.prompting = false
      session.currentTurnId = 5

      const result = service.cancel('ch1', 5)

      expect(result).toBe(false)
      expect(connection.cancel).not.toHaveBeenCalled()
    })

    it('returns false when channel has no session', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      expect(service.cancel('nonexistent', 1)).toBe(false)
    })

    it('preserves session (R4) after successful cancel', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      session.prompting = true
      session.currentTurnId = 1

      service.cancel('ch1', 1)

      expect(internals(service).sessions.has('ch1')).toBe(true)
    })
  })

  describe('C4 — turn ids are monotonic across teardown/recreate', () => {
    it('turnCounter survives teardown — new session gets a higher id than old session', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const conn = createMockConnection()

      // First session: let executePrompt mint a real turn id via turnCounter
      const s1 = injectSession(service, 'ch1', conn)
      await internals(service).executePrompt(s1, 'a', 'u')
      const idN = handlers.onPromptStart.mock.calls.at(-1)![1] as number

      service.teardown('ch1')

      // Second session: if teardown reset turnCounter the new id would collide with idN
      const s2 = injectSession(service, 'ch1', conn)
      await internals(service).executePrompt(s2, 'b', 'u')
      const idAfter = handlers.onPromptStart.mock.calls.at(-1)![1] as number

      expect(idAfter).toBeGreaterThan(idN)

      // A stale stop click for the old turn must not cancel the new session
      expect(service.cancel('ch1', idN)).toBe(false)
    })
  })

  describe('cancel vs drain race (R3 / AE1 — integration)', () => {
    it('does not re-invoke executePrompt for a queued item when cancel arrives from a separate task while prompt is pending', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      // Drive cancel from a real separate microtask while the prompt is genuinely
      // pending (not synchronously inside the mock), so the cancel lands in the
      // post-resolution → finally-drain window that C1 protects.
      let resolvePrompt!: (v: { stopReason: string }) => void
      connection.prompt.mockReturnValueOnce(
        new Promise(r => {
          resolvePrompt = r
        }),
      )

      const p = internals(service).executePrompt(session, 'first', 'user-1')
      // Queue an item while the prompt is in flight
      session.queue.push({ text: 'queued-item', userId: 'user-1', images: [] })
      // Cancel from a separate microtask — arrives before the finally-drain runs
      queueMicrotask(() => service.cancel('ch1', session.currentTurnId))
      resolvePrompt({ stopReason: 'cancelled' })

      await p

      // Drain must NOT have re-run: cancel cleared the queue before the finally drain
      expect(connection.prompt).toHaveBeenCalledTimes(1)
    })
  })

  describe('image-capability gate (U4)', () => {
    const img = { data: 'abc', mimeType: 'image/png' }

    it('returns no_image_support for image-only message when agent not image-capable', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const conn = createMockConnection()
      injectSession(service, 'ch1', conn) // imageCapable defaults to false

      const result = await service.prompt('ch1', '', 'user-1', [img])
      expect(result).toEqual({ kind: 'no_image_support' })
      expect(conn.prompt).not.toHaveBeenCalled()
    })

    it('drops images but proceeds when text is present and agent not image-capable', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const conn = createMockConnection()
      injectSession(service, 'ch1', conn)

      const result = await service.prompt('ch1', 'hi', 'user-1', [img])
      expect(result).toEqual({ kind: 'completed', stopReason: 'end_turn' })
      const { prompt: blocks } = conn.prompt.mock.calls[0][0] as {
        prompt: Array<{ type: string }>
      }
      expect(blocks.every(b => b.type !== 'image')).toBe(true)
    })

    it('passes images through when agent is image-capable', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const conn = createMockConnection()
      const session = injectSession(service, 'ch1', conn)
      session.imageCapable = true

      await service.prompt('ch1', 'hi', 'user-1', [img])
      const { prompt: blocks } = conn.prompt.mock.calls[0][0] as {
        prompt: Array<{ type: string }>
      }
      expect(blocks.some(b => b.type === 'image')).toBe(true)
    })
  })

  describe('onPromptComplete regression', () => {
    it('receives stopReason from normal completion', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection('end_turn')
      const session = injectSession(service, 'ch1', connection)

      await internals(service).executePrompt(session, 'hello', 'user-1')

      expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'end_turn')
    })

    it('receives "error" stopReason on throw', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      connection.prompt.mockRejectedValueOnce(new Error('oops'))
      const session = injectSession(service, 'ch1', connection)

      await expect(
        internals(service).executePrompt(session, 'hello', 'user-1'),
      ).rejects.toThrow('oops')
      expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'error')
    })
  })

  describe('DB recording — recordSpawn + markExited (#23)', () => {
    let recordSpawnSpy: jest.SpyInstance
    let markExitedSpy: jest.SpyInstance

    beforeEach(() => {
      // Intercept repo calls before they hit the mock DB.
      recordSpawnSpy = jest
        .spyOn(claudeProcessRepo, 'recordSpawn')
        .mockReturnValue({} as ReturnType<typeof claudeProcessRepo.recordSpawn>)
      markExitedSpy = jest
        .spyOn(claudeProcessRepo, 'markExited')
        .mockReturnValue(1)
      process.env[EnvKeys.BOT_GENERATION_ID] = '42'
    })

    afterEach(() => {
      recordSpawnSpy.mockRestore()
      markExitedSpy.mockRestore()
      delete process.env[EnvKeys.BOT_GENERATION_ID]
    })

    it('recordSpawn is called on session creation when generationId is set', async () => {
      const mockProc = new EventEmitter() as EventEmitter & {
        pid: number
        stdin: unknown
        stdout: EventEmitter
        kill: jest.Mock
      }
      mockProc.pid = 9999
      mockProc.stdin = new Writable({ write: (_c, _e, cb) => cb() })
      mockProc.stdout = new Readable({ read: () => {} })
      mockProc.kill = jest.fn()

      jest.mocked(spawn).mockReturnValue(mockProc as never)
      ;(ClientSideConnection as jest.Mock).mockImplementation(() => ({
        initialize: jest
          .fn()
          .mockResolvedValue({ agentCapabilities: { promptCapabilities: {} } }),
        newSession: jest.fn().mockResolvedValue({ sessionId: 'test-session' }),
        prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
      }))

      const handlers = createMockHandlers()
      const service = await createService(handlers)

      await service.prompt('channel-1', 'hello', 'user-1')

      expect(recordSpawnSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pgid: 9999,
          generationId: 42,
          channelId: 'channel-1',
        }),
      )
    })

    it('markExited is called when the process exits with a generationId set', async () => {
      const mockProc = new EventEmitter() as EventEmitter & {
        pid: number
        stdin: unknown
        stdout: EventEmitter
        kill: jest.Mock
      }
      mockProc.pid = 8888
      mockProc.stdin = new Writable({ write: (_c, _e, cb) => cb() })
      mockProc.stdout = new Readable({ read: () => {} })
      mockProc.kill = jest.fn()

      jest.mocked(spawn).mockReturnValue(mockProc as never)
      ;(ClientSideConnection as jest.Mock).mockImplementation(() => ({
        initialize: jest
          .fn()
          .mockResolvedValue({ agentCapabilities: { promptCapabilities: {} } }),
        newSession: jest
          .fn()
          .mockResolvedValue({ sessionId: 'test-session-2' }),
        prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
      }))

      const handlers = createMockHandlers()
      const service = await createService(handlers)

      await service.prompt('channel-2', 'hello', 'user-1')
      // Simulate process exit.
      mockProc.emit('exit', 0)

      expect(markExitedSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pgid: 8888,
          generationId: 42,
        }),
      )
    })

    it('recordSpawn is not called when generationId is null (no BOT_GENERATION_ID)', async () => {
      delete process.env[EnvKeys.BOT_GENERATION_ID]

      const mockProc = new EventEmitter() as EventEmitter & {
        pid: number
        stdin: unknown
        stdout: EventEmitter
        kill: jest.Mock
      }
      mockProc.pid = 7777
      mockProc.stdin = new Writable({ write: (_c, _e, cb) => cb() })
      mockProc.stdout = new Readable({ read: () => {} })
      mockProc.kill = jest.fn()

      jest.mocked(spawn).mockReturnValue(mockProc as never)
      ;(ClientSideConnection as jest.Mock).mockImplementation(() => ({
        initialize: jest
          .fn()
          .mockResolvedValue({ agentCapabilities: { promptCapabilities: {} } }),
        newSession: jest
          .fn()
          .mockResolvedValue({ sessionId: 'test-session-3' }),
        prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
      }))

      const handlers = createMockHandlers()
      const service = await createService(handlers)

      await service.prompt('channel-3', 'hello', 'user-1')

      expect(recordSpawnSpy).not.toHaveBeenCalled()
    })
  })
})
