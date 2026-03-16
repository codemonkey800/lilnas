import {
  createMockStateService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { REASONING_TEMPERATURE } from 'src/constants/llm'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { StateService } from 'src/state/state.service'

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(config => ({
    _config: config,
    bindTools: jest.fn().mockReturnThis(),
  })),
}))

describe('ModelFactoryService', () => {
  let service: ModelFactoryService
  let stateService: jest.Mocked<StateService>
  let MockChatOpenAI: jest.Mock

  beforeEach(async () => {
    MockChatOpenAI = jest.requireMock('@langchain/openai')
      .ChatOpenAI as jest.Mock
    MockChatOpenAI.mockClear()

    stateService = createMockStateService()
    stateService.getState.mockReturnValue({
      chatModel: 'gpt-4-turbo',
      reasoningModel: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      prompt: 'test prompt',
      graphHistory: [],
    })

    const module = await createTestingModule([
      ModelFactoryService,
      { provide: StateService, useValue: stateService },
    ])

    service = module.get(ModelFactoryService)
  })

  describe('createChatModel', () => {
    it('creates a ChatOpenAI with chatModel and temperature from state', () => {
      service.createChatModel()

      expect(MockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4-turbo',
          temperature: 0.7,
        }),
      )
    })

    it('returns the ChatOpenAI instance when called without tools', () => {
      const result = service.createChatModel()

      expect(result).toBeDefined()
      expect(
        (result as unknown as { _config: Record<string, unknown> })._config,
      ).toMatchObject({
        model: 'gpt-4-turbo',
        temperature: 0.7,
      })
    })

    it('calls bindTools when tools are provided', () => {
      const mockModel = {
        _config: { model: 'gpt-4-turbo' },
        bindTools: jest.fn().mockReturnThis(),
      }
      MockChatOpenAI.mockImplementationOnce(() => mockModel)

      const tools = [{ name: 'get_date' }] as unknown as Parameters<
        typeof service.createChatModel
      >[0]
      service.createChatModel(tools)

      expect(mockModel.bindTools).toHaveBeenCalledWith(tools)
    })

    it('returns bound model when tools are provided', () => {
      const boundModel = { _isBound: true }
      const mockModel = {
        _config: {},
        bindTools: jest.fn().mockReturnValue(boundModel),
      }
      MockChatOpenAI.mockImplementationOnce(() => mockModel)

      const result = service.createChatModel([
        { name: 'tool' },
      ] as unknown as Parameters<typeof service.createChatModel>[0])

      expect(result).toBe(boundModel)
    })

    it('does not call bindTools when no tools are passed', () => {
      const mockModel = {
        _config: {},
        bindTools: jest.fn(),
      }
      MockChatOpenAI.mockImplementationOnce(() => mockModel)

      service.createChatModel()

      expect(mockModel.bindTools).not.toHaveBeenCalled()
    })
  })

  describe('createReasoningModel', () => {
    it('creates a ChatOpenAI with reasoningModel and REASONING_TEMPERATURE', () => {
      service.createReasoningModel()

      expect(MockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          temperature: REASONING_TEMPERATURE,
        }),
      )
    })

    it('returns the ChatOpenAI instance', () => {
      const result = service.createReasoningModel()

      expect(result).toBeDefined()
    })

    it('reads reasoningModel from StateService', () => {
      stateService.getState.mockReturnValue({
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o',
        temperature: 0,
        maxTokens: 1000,
        prompt: 'prompt',
        graphHistory: [],
      })

      service.createReasoningModel()

      expect(MockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o' }),
      )
    })
  })
})
