import { Test } from '@nestjs/testing'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'

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

function sessions(
  service: SessionManagerService,
): Map<
  string,
  { prompting: boolean; idleTimer: NodeJS.Timeout; process: unknown }
> {
  return (
    service as unknown as {
      sessions: Map<
        string,
        { prompting: boolean; idleTimer: NodeJS.Timeout; process: unknown }
      >
    }
  ).sessions
}

function injectPromptingSession(
  service: SessionManagerService,
  channelId: string,
) {
  const mockProc = { pid: 1234, kill: jest.fn(), on: jest.fn() }
  const session = {
    channelId,
    process: mockProc,
    connection: {
      prompt: jest.fn(),
      cancel: jest.fn(),
      initialize: jest.fn(),
      newSession: jest.fn(),
    },
    sessionId: 'session-x',
    lastActivity: Date.now(),
    idleTimer: setTimeout(() => {}, 99999),
    prompting: true,
    imageCapable: false,
    currentTurnId: 1,
    queue: [],
    activeUserId: 'user-1',
  }
  sessions(service).set(channelId, session)
  return session
}

describe('SessionManagerService — teardown abort signal (U1, R4)', () => {
  it('fires onPromptComplete("aborted") when tearing down a prompting session', () => {
    const handlers = createMockHandlers()

    const service = new (SessionManagerService as unknown as {
      new (h: AcpEventHandlers): SessionManagerService
    })(handlers)

    injectPromptingSession(service, 'ch1')
    service.teardown('ch1')

    expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'aborted')
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('does NOT fire onPromptComplete when tearing down a non-prompting session', () => {
    const handlers = createMockHandlers()

    const service = new (SessionManagerService as unknown as {
      new (h: AcpEventHandlers): SessionManagerService
    })(handlers)

    const session = injectPromptingSession(service, 'ch1')
    session.prompting = false

    service.teardown('ch1')

    expect(handlers.onPromptComplete).not.toHaveBeenCalled()
  })

  it('fires the abort signal exactly once (executePrompt error path sets prompting=false before teardown)', async () => {
    const handlers = createMockHandlers()

    const module = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: ACP_EVENT_HANDLERS, useValue: handlers },
      ],
    }).compile()
    const service = module.get(SessionManagerService)

    const session = injectPromptingSession(service, 'ch1')
    session.prompting = true

    const mockConn = session.connection as { prompt: jest.Mock }
    mockConn.prompt.mockRejectedValueOnce(new Error('crash'))

    // Simulate the executePrompt path by manually calling through the catch path
    // We do this by accessing the private method and verifying that when the error
    // path sets prompting=false before teardown, onPromptComplete fires exactly once.
    const internals = service as unknown as {
      executePrompt: (
        s: typeof session,
        text: string,
        userId: string,
      ) => Promise<string>
    }

    await expect(
      internals.executePrompt(session, 'hello', 'user-1'),
    ).rejects.toThrow('crash')

    // 'error' from the catch block — NOT 'aborted' from teardown
    expect(handlers.onPromptComplete).toHaveBeenCalledTimes(1)
    expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'error')
  })
})
