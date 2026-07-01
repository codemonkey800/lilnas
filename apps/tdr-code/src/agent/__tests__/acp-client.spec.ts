import type { AcpEventHandlers } from 'src/agent/agent.types'

// setup.ts mocks 'src/agent/acp-client' globally; use requireActual to test the real implementation
const { createAcpClient } = jest.requireActual(
  '../acp-client',
) as typeof import('../acp-client')

function createMockHandlers(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onGitPushBlocked: jest.fn(),
  }
}

describe('createAcpClient — agent_message_chunk routing', () => {
  it('routes text content to onAgentMessageChunk (regression)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as never)

    expect(handlers.onAgentMessageChunk).toHaveBeenCalledWith('ch1', 'hello')
    expect(handlers.onAgentMessageImage).not.toHaveBeenCalled()
  })

  it('routes image content to onAgentMessageImage (U5, R13)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'abc123', mimeType: 'image/png' },
      },
    } as never)

    expect(handlers.onAgentMessageImage).toHaveBeenCalledWith(
      'ch1',
      'abc123',
      'image/png',
    )
    expect(handlers.onAgentMessageChunk).not.toHaveBeenCalled()
  })

  it('ignores unknown content types silently (regression)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'audio', data: 'xyz' },
      },
    } as never)

    expect(handlers.onAgentMessageChunk).not.toHaveBeenCalled()
    expect(handlers.onAgentMessageImage).not.toHaveBeenCalled()
  })
})
