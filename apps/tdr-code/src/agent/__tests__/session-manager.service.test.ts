import { Test } from '@nestjs/testing'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'

import { SessionManagerService } from '../session-manager.service'

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
  executePrompt: (session: TestSession, text: string, userId: string, images?: never[]) => Promise<string>
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
    it('stale turn id from old session does not match new session after teardown', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()

      const oldSession = injectSession(service, 'ch1', connection)
      oldSession.prompting = true
      oldSession.currentTurnId = 1

      service.teardown('ch1')

      // Recreate session with new (higher) turn id
      const newSession = injectSession(service, 'ch1', connection)
      newSession.prompting = true
      newSession.currentTurnId = 2

      // Stale old button click with turn id 1 must not cancel new turn 2
      const result = service.cancel('ch1', 1)
      expect(result).toBe(false)
    })
  })

  describe('cancel vs drain race (R3 / AE1 — integration)', () => {
    it('does not re-invoke executePrompt for a queued item after cancel clears the queue', async () => {
      const handlers = createMockHandlers()
      const service = await createService(handlers)
      const connection = createMockConnection()
      const session = injectSession(service, 'ch1', connection)

      let cancelCalled = false
      connection.prompt.mockImplementationOnce(async () => {
        // Inject cancel inside the contended window — while prompt is in flight
        session.currentTurnId = 1
        session.prompting = true
        session.queue.push({ text: 'queued-item', userId: 'user-1', images: [] })
        cancelCalled = true
        service.cancel('ch1', 1)
        return { stopReason: 'cancelled' }
      })

      session.prompting = true
      session.currentTurnId = 1

      await internals(service).executePrompt(session, 'first', 'user-1')

      expect(cancelCalled).toBe(true)
      // Queue must be empty after cancel — drain should not have re-run
      expect(connection.prompt).toHaveBeenCalledTimes(1)
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
})
