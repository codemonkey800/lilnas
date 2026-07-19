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
    onSessionInfoUpdate: jest.fn(),
    onResumeFailed: jest.fn(),
    onUsageUpdate: jest.fn(),
    onGitOperationBlocked: jest.fn(),
  }
}

// Asserts that none of the AcpEventHandlers methods were invoked — used by the
// suppression-gate tests (R10) to prove the single guard covers every variant.
function expectNoHandlerCalls(handlers: jest.Mocked<AcpEventHandlers>): void {
  expect(handlers.onToolCall).not.toHaveBeenCalled()
  expect(handlers.onToolCallUpdate).not.toHaveBeenCalled()
  expect(handlers.onAgentMessageChunk).not.toHaveBeenCalled()
  expect(handlers.onAgentMessageImage).not.toHaveBeenCalled()
  expect(handlers.onSessionInfoUpdate).not.toHaveBeenCalled()
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

describe('createAcpClient — isReplaying suppression gate (U3, R10)', () => {
  it('dispatches agent_message_chunk normally when isReplaying is false', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers, () => false)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as never)

    expect(handlers.onAgentMessageChunk).toHaveBeenCalledWith('ch1', 'hello')
  })

  it('suppresses agent_message_chunk entirely when isReplaying is true', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers, () => true)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as never)

    expectNoHandlerCalls(handlers)
  })

  it('suppresses tool_call and tool_call_update while replaying (proves the gate covers tool events, not just message chunks)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers, () => true)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc1',
        title: 'Read file',
        kind: 'read',
        status: 'pending',
        content: [],
      },
    } as never)
    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc1',
        status: 'completed',
        content: [],
      },
    } as never)

    expect(handlers.onToolCall).not.toHaveBeenCalled()
    expect(handlers.onToolCallUpdate).not.toHaveBeenCalled()
  })

  it('behaves as non-replaying when isReplaying is not passed at all (backward compatibility)', async () => {
    const handlers = createMockHandlers()
    // Only 2 args — matches the current session-manager.service.ts call site,
    // which a later unit (U4) will extend to 3. This must keep working.
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as never)

    expect(handlers.onAgentMessageChunk).toHaveBeenCalledWith('ch1', 'hello')
  })

  it('reads the predicate live on every call, not a value captured once at construction', async () => {
    const handlers = createMockHandlers()
    let replaying = true
    const client = createAcpClient('ch1', handlers, () => replaying)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'first' },
      },
    } as never)
    expect(handlers.onAgentMessageChunk).not.toHaveBeenCalled()

    replaying = false

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'second' },
      },
    } as never)
    expect(handlers.onAgentMessageChunk).toHaveBeenCalledWith('ch1', 'second')
    expect(handlers.onAgentMessageChunk).toHaveBeenCalledTimes(1)
  })
})

describe('createAcpClient — session_info_update dispatch (U3, R12)', () => {
  it('calls onSessionInfoUpdate with the title when a non-empty title is present', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'session_info_update',
        title: 'some title',
      },
    } as never)

    expect(handlers.onSessionInfoUpdate).toHaveBeenCalledWith(
      'ch1',
      'some title',
    )
  })

  it('is suppressed while replaying (no onSessionInfoUpdate call)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers, () => true)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'session_info_update',
        title: 'some title',
      },
    } as never)

    expect(handlers.onSessionInfoUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])(
    'does not call onSessionInfoUpdate when title is %s',
    async (_label, title) => {
      const handlers = createMockHandlers()
      const client = createAcpClient('ch1', handlers)

      await client.sessionUpdate!({
        update: {
          sessionUpdate: 'session_info_update',
          title,
        },
      } as never)

      expect(handlers.onSessionInfoUpdate).not.toHaveBeenCalled()
    },
  )
})

describe('createAcpClient — tool_call_update dispatch', () => {
  it('forwards the resolved title once the tool input finishes streaming (regression: bare "Terminal"/"Read" label never resolving to the real command/file)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc1',
        status: 'in_progress',
        title: 'git status',
        content: [],
        rawInput: { command: 'git status' },
      },
    } as never)

    expect(handlers.onToolCallUpdate).toHaveBeenCalledWith(
      'ch1',
      'tc1',
      'in_progress',
      [],
      { command: 'git status' },
      'git status',
      undefined,
    )
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])(
    'forwards undefined as the title when the update title is %s (no change from the placeholder)',
    async (_label, title) => {
      const handlers = createMockHandlers()
      const client = createAcpClient('ch1', handlers)

      await client.sessionUpdate!({
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc1',
          status: 'completed',
          title,
          content: [],
        },
      } as never)

      expect(handlers.onToolCallUpdate).toHaveBeenCalledWith(
        'ch1',
        'tc1',
        'completed',
        [],
        undefined,
        undefined,
        undefined,
      )
    },
  )
})

describe('createAcpClient — usage_update dispatch', () => {
  it('calls onUsageUpdate with used/size forwarded verbatim', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'usage_update',
        used: 15000,
        size: 200000,
      },
    } as never)

    expect(handlers.onUsageUpdate).toHaveBeenCalledWith('ch1', 15000, 200000)
  })

  it('is suppressed while replaying (no onUsageUpdate call)', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers, () => true)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'usage_update',
        used: 15000,
        size: 200000,
      },
    } as never)

    expect(handlers.onUsageUpdate).not.toHaveBeenCalled()
  })
})

describe('createAcpClient — plan-mode: switch_mode tool_call plan-text extraction', () => {
  it('extracts the plan markdown from a switch_mode tool_call content block and forwards it as the 8th onToolCall arg', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'plan-1',
        title: 'Ready to code?',
        kind: 'switch_mode',
        status: 'pending',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'Step 1: do it.' },
          },
        ],
      },
    } as never)

    expect(handlers.onToolCall).toHaveBeenCalledWith(
      'ch1',
      'plan-1',
      'Ready to code?',
      'switch_mode',
      'pending',
      [],
      undefined,
      'Step 1: do it.',
    )
  })

  it('forwards undefined planText for a non-switch_mode tool_call, even with a content block present', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc1',
        title: 'Read file',
        kind: 'read',
        status: 'pending',
        content: [
          { type: 'content', content: { type: 'text', text: 'not a plan' } },
        ],
      },
    } as never)

    expect(handlers.onToolCall).toHaveBeenCalledWith(
      'ch1',
      'tc1',
      'Read file',
      'read',
      'pending',
      [],
      undefined,
      undefined,
    )
  })

  it('forwards undefined planText for a switch_mode tool_call with no content blocks', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'plan-2',
        title: 'Ready to code?',
        kind: 'switch_mode',
        status: 'pending',
        content: [],
      },
    } as never)

    expect(handlers.onToolCall).toHaveBeenCalledWith(
      'ch1',
      'plan-2',
      'Ready to code?',
      'switch_mode',
      'pending',
      [],
      undefined,
      undefined,
    )
  })
})

describe('createAcpClient — plan-mode: requestPermission gate interception', () => {
  it('delegates a switch_mode permission request to onPlanApprovalNeeded instead of auto-picking options[0]', async () => {
    const handlers = createMockHandlers()
    const onPlanApprovalNeeded = jest
      .fn()
      .mockResolvedValue({ outcome: { outcome: 'cancelled' } })
    const client = createAcpClient(
      'ch1',
      handlers,
      undefined,
      onPlanApprovalNeeded,
    )

    // The plan text must be captured off a preceding tool_call first —
    // mirrors the real wrapper's event ordering (notification, then request).
    await client.sessionUpdate!({
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'plan-1',
        title: 'Ready to code?',
        kind: 'switch_mode',
        status: 'pending',
        content: [
          { type: 'content', content: { type: 'text', text: 'the plan' } },
        ],
      },
    } as never)

    const options = [
      {
        kind: 'allow_always',
        name: 'Yes, and bypass permissions',
        optionId: 'bypassPermissions',
      },
      { kind: 'reject_once', name: 'No, keep planning', optionId: 'plan' },
    ]
    const result = await client.requestPermission!({
      sessionId: 'sess1',
      toolCall: { toolCallId: 'plan-1', kind: 'switch_mode' },
      options,
    } as never)

    expect(onPlanApprovalNeeded).toHaveBeenCalledWith({
      channelId: 'ch1',
      toolCallId: 'plan-1',
      planText: 'the plan',
      options,
    })
    expect(result).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('falls through to auto-pick options[0] for a switch_mode request when no onPlanApprovalNeeded callback is provided', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers) // no 4th arg

    const result = await client.requestPermission!({
      sessionId: 'sess1',
      toolCall: { toolCallId: 'plan-1', kind: 'switch_mode' },
      options: [{ kind: 'allow_once', name: 'default', optionId: 'default' }],
    } as never)

    expect(result).toEqual({
      outcome: { outcome: 'selected', optionId: 'default' },
    })
  })

  it('auto-picks options[0] for an ordinary (non-switch_mode) permission request, unaffected by onPlanApprovalNeeded being present', async () => {
    const handlers = createMockHandlers()
    const onPlanApprovalNeeded = jest.fn()
    const client = createAcpClient(
      'ch1',
      handlers,
      undefined,
      onPlanApprovalNeeded,
    )

    const result = await client.requestPermission!({
      sessionId: 'sess1',
      toolCall: { toolCallId: 'tc1', kind: 'execute' },
      options: [{ kind: 'allow_once', name: 'allow', optionId: 'allow' }],
    } as never)

    expect(onPlanApprovalNeeded).not.toHaveBeenCalled()
    expect(result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })
  })

  it('auto-resolves as cancelled when there are no options at all', async () => {
    const handlers = createMockHandlers()
    const client = createAcpClient('ch1', handlers)

    const result = await client.requestPermission!({
      sessionId: 'sess1',
      toolCall: { toolCallId: 'tc1', kind: 'execute' },
      options: [],
    } as never)

    expect(result).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})
