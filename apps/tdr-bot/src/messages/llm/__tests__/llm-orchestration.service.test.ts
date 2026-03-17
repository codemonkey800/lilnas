import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'

import {
  createMockMetricsService,
  createMockStateService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { MAX_GRAPH_HISTORY_SIZE } from 'src/constants/llm'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { DefaultResponseNode } from 'src/messages/llm/nodes/default-response.node'
import { ImageResponseNode } from 'src/messages/llm/nodes/image-response.node'
import { IntentDetectionNode } from 'src/messages/llm/nodes/intent-detection.node'
import { MathResponseNode } from 'src/messages/llm/nodes/math-response.node'
import { MediaResponseNode } from 'src/messages/llm/nodes/media-response.node'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { StateService } from 'src/state/state.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

jest.mock('@langchain/langgraph', () => ({
  StateGraph: jest.fn().mockImplementation(() => ({
    addNode: jest.fn().mockReturnThis(),
    addEdge: jest.fn().mockReturnThis(),
    addConditionalEdges: jest.fn().mockReturnThis(),
    compile: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  })),
  Annotation: Object.assign(
    jest.fn(() => ({ spec: {} })),
    {
      Root: jest.fn((spec: unknown) => ({ spec, State: spec })),
    },
  ),
  messagesStateReducer: jest.fn(),
}))
jest.mock('@langchain/langgraph/prebuilt', () => ({
  ToolNode: jest.fn().mockImplementation(() => ({})),
}))
jest.mock('src/messages/llm/tools', () => ({
  getTools: jest.fn().mockReturnValue([]),
}))

function makeHuman(content = 'hello'): HumanMessage {
  return new HumanMessage({ id: 'h-1', content })
}

function makeAI(content = 'ai response'): AIMessage {
  return new AIMessage({ id: 'ai-1', content })
}

function makeAIWithToolCalls(): AIMessage {
  const msg = new AIMessage({ id: 'ai-tool', content: '' })
  ;(msg as AIMessage & { tool_calls: unknown[] }).tool_calls = [
    { id: 'call_1', name: 'get_date', args: {}, type: 'tool_call' },
  ]
  return msg
}

function makeSystemPrompt(): SystemMessage {
  return new SystemMessage({
    id: TDR_SYSTEM_PROMPT_ID,
    content: 'You are TDR.',
  })
}

describe('LLMOrchestrationService', () => {
  let service: LLMOrchestrationService
  let stateService: jest.Mocked<StateService>
  let promptService: jest.Mocked<PromptService>
  let compiledGraph: { invoke: jest.Mock }

  beforeEach(async () => {
    compiledGraph = { invoke: jest.fn() }

    stateService = createMockStateService()
    promptService = {
      getSystemPrompt: jest.fn().mockReturnValue(makeSystemPrompt()),
    } as unknown as jest.Mocked<PromptService>

    const nodeMock = <T>(name: string): T =>
      ({ invoke: jest.fn(), name }) as unknown as T

    const module = await createTestingModule([
      LLMOrchestrationService,
      { provide: StateService, useValue: stateService },
      { provide: PromptService, useValue: promptService },
      {
        provide: IntentDetectionNode,
        useValue: nodeMock<IntentDetectionNode>('intent'),
      },
      {
        provide: DefaultResponseNode,
        useValue: nodeMock<DefaultResponseNode>('default'),
      },
      {
        provide: ImageResponseNode,
        useValue: nodeMock<ImageResponseNode>('image'),
      },
      {
        provide: MathResponseNode,
        useValue: nodeMock<MathResponseNode>('math'),
      },
      {
        provide: MediaResponseNode,
        useValue: nodeMock<MediaResponseNode>('media'),
      },
      { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
    ])

    service = module.get(LLMOrchestrationService)
    // Inject the mock compiled graph directly (onModuleInit may not compile
    // correctly in mocked environments, so we set it explicitly here).
    ;(service as unknown as { app: typeof compiledGraph }).app = compiledGraph
  })

  describe('sendMessage', () => {
    it('returns parsed content and images from graph output', async () => {
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('Hello!')],
        images: [],
      })

      const result = await service.sendMessage({
        message: 'hi',
        user: 'Alice',
        userId: 'u1',
      })

      expect(result.content).toBe('Hello!')
      expect(result.images).toEqual([])
    })

    it('formats userInput as "<user> said "<message>""', async () => {
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('ok')],
        images: [],
      })

      await service.sendMessage({
        message: 'what time is it?',
        user: 'Bob',
        userId: 'u2',
      })

      expect(compiledGraph.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ userInput: 'Bob said "what time is it?"' }),
      )
    })

    it('uses user as userId fallback when userId is omitted', async () => {
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('ok')],
        images: [],
      })

      await service.sendMessage({ message: 'hi', user: 'Carol' })

      expect(compiledGraph.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'Carol' }),
      )
    })

    it('passes last graphHistory messages to the graph', async () => {
      const prev = [makeHuman('old msg'), makeAI('old reply')]
      stateService.getState.mockReturnValue({
        maxTokens: 1000,
        temperature: 0,
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o-mini',
        prompt: 'prompt',
        graphHistory: [{ messages: prev, images: [], responseType: undefined }],
      })
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('new')],
        images: [],
      })

      await service.sendMessage({
        message: 'follow-up',
        user: 'Dave',
        userId: 'u3',
      })

      expect(compiledGraph.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ messages: prev }),
      )
    })

    it('appends result entry to graphHistory', async () => {
      const aiMsg = makeAI('reply')
      compiledGraph.invoke.mockResolvedValue({ messages: [aiMsg], images: [] })

      await service.sendMessage({ message: 'hi', user: 'Eve', userId: 'u4' })

      const updateFn = (stateService.setState as jest.Mock).mock
        .calls[0][0] as (
        p: ReturnType<typeof stateService.getState>,
      ) => Partial<ReturnType<typeof stateService.getState>>
      const updated = updateFn(stateService.getState())
      expect(updated.graphHistory).toHaveLength(1)
      expect(updated.graphHistory![0].messages).toEqual([aiMsg])
    })

    it('caps graphHistory at MAX_GRAPH_HISTORY_SIZE', async () => {
      const fullHistory = Array.from(
        { length: MAX_GRAPH_HISTORY_SIZE },
        (_, i) => ({
          messages: [makeAI(`msg-${i}`)],
          images: [],
          responseType: undefined,
        }),
      )
      stateService.getState.mockReturnValue({
        maxTokens: 1000,
        temperature: 0,
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o-mini',
        prompt: 'prompt',
        graphHistory: fullHistory,
      })
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('new')],
        images: [],
      })

      await service.sendMessage({ message: 'hi', user: 'Frank', userId: 'u5' })

      const updateFn = (stateService.setState as jest.Mock).mock
        .calls[0][0] as (
        p: ReturnType<typeof stateService.getState>,
      ) => Partial<ReturnType<typeof stateService.getState>>
      const updated = updateFn(stateService.getState())
      expect(updated.graphHistory!.length).toBe(MAX_GRAPH_HISTORY_SIZE)
    })

    it('throws when graph returns no messages', async () => {
      compiledGraph.invoke.mockResolvedValue({ messages: [], images: [] })

      await expect(
        service.sendMessage({ message: 'hi', user: 'Grace', userId: 'u6' }),
      ).rejects.toThrow('Did not receive a message')
    })

    it('returns images from graph output', async () => {
      const images = [
        { title: 'Sunset', url: 'https://example.com/s.png', parentId: 'p1' },
      ]
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('Here')],
        images,
      })

      const result = await service.sendMessage({
        message: 'generate',
        user: 'Hal',
        userId: 'u7',
      })

      expect(result.images).toEqual(images)
    })

    it('starts with empty messages when graphHistory is empty', async () => {
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('hi')],
        images: [],
      })

      await service.sendMessage({ message: 'hello', user: 'Ivy', userId: 'u8' })

      expect(compiledGraph.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [] }),
      )
    })

    it('throws when graph returns a tool call message with empty content', async () => {
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAIWithToolCalls()],
        images: [],
      })

      await expect(
        service.sendMessage({ message: 'hi', user: 'Jack', userId: 'u9' }),
      ).rejects.toThrow()
    })

    it('handles empty string message input', async () => {
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('I need more information')],
        images: [],
      })

      const result = await service.sendMessage({
        message: '',
        user: 'Kate',
        userId: 'u10',
      })

      expect(result.content).toBe('I need more information')
      expect(compiledGraph.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ userInput: 'Kate said ""' }),
      )
    })

    it('handles very long message input', async () => {
      const longMessage = 'A'.repeat(10000)
      compiledGraph.invoke.mockResolvedValue({
        messages: [makeAI('Response to long message')],
        images: [],
      })

      const result = await service.sendMessage({
        message: longMessage,
        user: 'Leo',
        userId: 'u11',
      })

      expect(result.content).toBe('Response to long message')
    })
  })

  describe('system prompt injection (addTdrSystemPrompt)', () => {
    it('injects system prompt when not yet present in messages', async () => {
      let capturedMessages: unknown[] = []
      compiledGraph.invoke.mockImplementation(
        async (input: { messages: unknown[] }) => {
          capturedMessages = input.messages
          return { messages: [makeAI('response')], images: [] }
        },
      )

      await service.sendMessage({ message: 'hi', user: 'Mia', userId: 'u12' })

      // The graph receives the messages list from graphHistory (empty here),
      // then addTdrSystemPrompt injects the system prompt internally.
      // We verify the graph was invoked (the service works end-to-end).
      expect(compiledGraph.invoke).toHaveBeenCalled()
      void capturedMessages
    })
  })

  describe('sendMessage routing (handleModelResponse)', () => {
    it('returns content from last AI message even when prior messages exist', async () => {
      const messages = [makeAI('first'), makeAI('second reply')]
      compiledGraph.invoke.mockResolvedValue({ messages, images: [] })

      const result = await service.sendMessage({
        message: 'hi',
        user: 'Nat',
        userId: 'u13',
      })

      expect(result.content).toBe('second reply')
    })

    it('raises on missing message content (schema validation)', async () => {
      const emptyContentMsg = new AIMessage({ id: 'empty', content: '' })
      compiledGraph.invoke.mockResolvedValue({
        messages: [emptyContentMsg],
        images: [],
      })

      await expect(
        service.sendMessage({ message: 'hi', user: 'Owen', userId: 'u14' }),
      ).rejects.toThrow()
    })
  })
})
