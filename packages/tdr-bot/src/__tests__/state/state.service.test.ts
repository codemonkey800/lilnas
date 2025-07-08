import { SystemMessage } from '@langchain/core/messages'
import { EventEmitter2 } from '@nestjs/event-emitter'

import { createTestingModule } from 'src/__tests__/test-utils'
import {
  AppState,
  StateChangeEvent,
  StateService,
} from 'src/state/state.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

describe('StateService', () => {
  let service: StateService
  let eventEmitter: jest.Mocked<EventEmitter2>

  beforeEach(async () => {
    eventEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>

    const module = await createTestingModule([
      StateService,
      {
        provide: EventEmitter2,
        useValue: eventEmitter,
      },
    ])

    service = module.get<StateService>(StateService)
  })

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const state = service.getState()

      expect(state).toEqual({
        graphHistory: [],
        maxTokens: 50_000,
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o-mini',
        prompt: expect.stringContaining('kawaii'), // KAWAII_PROMPT
        temperature: 0,
      })
    })
  })

  describe('setState', () => {
    it('should update state with object', () => {
      const newState: Partial<AppState> = {
        maxTokens: 100_000,
        temperature: 0.7,
      }

      service.setState(newState)

      const state = service.getState()
      expect(state.maxTokens).toBe(100_000)
      expect(state.temperature).toBe(0.7)
      expect(state.chatModel).toBe('gpt-4-turbo') // unchanged
    })

    it('should update state with function', () => {
      service.setState(prevState => ({
        maxTokens: prevState.maxTokens * 2,
      }))

      const state = service.getState()
      expect(state.maxTokens).toBe(100_000)
    })

    it('should merge nested objects properly', () => {
      const graphHistory = [
        {
          messages: [{ content: 'test' }],
          images: [],
        },
      ] as unknown as AppState['graphHistory']

      service.setState({ graphHistory })

      const state = service.getState()
      expect(state.graphHistory).toEqual(graphHistory)
    })

    it('should emit state change event', () => {
      const prevState = service.getState()
      const newState = { temperature: 0.9 }

      service.setState(newState)

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'state.change',
        expect.any(StateChangeEvent),
      )

      const [eventName, event] = eventEmitter.emit.mock.calls[0]
      expect(eventName).toBe('state.change')
      expect(event.prevState).toEqual(prevState)
      expect(event.nextState.temperature).toBe(0.9)
    })

    it('should handle function-based state updates with events', () => {
      const updateFn = jest.fn((_state: AppState) => {
        void _state
        return {
          chatModel: 'gpt-4' as const,
        }
      })

      service.setState(updateFn)

      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          chatModel: 'gpt-4-turbo',
        }),
      )
      expect(eventEmitter.emit).toHaveBeenCalled()
    })
  })

  describe('getState', () => {
    it('should return current state', () => {
      const state1 = service.getState()
      service.setState({ temperature: 0.5 })
      const state2 = service.getState()

      expect(state1.temperature).toBe(0)
      expect(state2.temperature).toBe(0.5)
    })

    it('should return the same reference when no changes', () => {
      const state1 = service.getState()
      const state2 = service.getState()

      expect(state1).toBe(state2)
    })
  })

  describe('getPrompt', () => {
    it('should generate system message with correct ID', () => {
      const prompt = service.getPrompt()

      expect(prompt).toBeInstanceOf(SystemMessage)
      expect(prompt.id).toBe(TDR_SYSTEM_PROMPT_ID)
    })

    it('should include all prompt components', () => {
      const prompt = service.getPrompt()
      const content = prompt.content as string

      // Check for actual content patterns from the prompts
      expect(content).toContain('You are') // Common prompt intro pattern
      expect(content).toContain('said') // From INPUT_FORMAT pattern
      expect(content).toContain('kawaii') // From KAWAII_PROMPT
      expect(content).toContain(':') // Emojis have colons in the dictionary
    })

    it('should update prompt content when state changes', () => {
      service.getPrompt()

      service.setState({ prompt: 'New custom prompt' })

      const prompt2 = service.getPrompt()
      const content2 = prompt2.content as string

      expect(content2).toContain('New custom prompt')
      expect(content2).not.toContain('kawaii')
    })
  })

  describe('complex state management', () => {
    it('should handle multiple sequential updates', () => {
      service.setState({ temperature: 0.3 })
      service.setState({ maxTokens: 75_000 })
      service.setState(state => ({
        chatModel: state.temperature > 0.5 ? 'gpt-4' : 'gpt-3.5-turbo',
      }))

      const finalState = service.getState()
      expect(finalState).toMatchObject({
        temperature: 0.3,
        maxTokens: 75_000,
        chatModel: 'gpt-3.5-turbo',
      })

      expect(eventEmitter.emit).toHaveBeenCalledTimes(3)
    })

    it('should preserve graph history when updating other fields', () => {
      const history = [
        {
          messages: [{ content: 'msg1' }],
          images: ['img1'],
        },
        {
          messages: [{ content: 'msg2' }],
          images: ['img2'],
        },
      ] as unknown as AppState['graphHistory']

      service.setState({ graphHistory: history })
      service.setState({ temperature: 0.8 })

      const state = service.getState()
      expect(state.graphHistory).toEqual(history)
      expect(state.temperature).toBe(0.8)
    })

    it('should handle empty state updates', () => {
      const prevState = service.getState()

      service.setState({})

      const newState = service.getState()
      expect(newState).toEqual(prevState)
      expect(eventEmitter.emit).toHaveBeenCalled()
    })
  })

  describe('StateChangeEvent', () => {
    it('should create event with correct properties', () => {
      const prevState: AppState = {
        graphHistory: [],
        maxTokens: 50_000,
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o-mini',
        prompt: 'test',
        temperature: 0,
      }

      const nextState: Partial<AppState> = {
        temperature: 0.7,
      }

      const event = new StateChangeEvent(prevState, nextState)

      expect(event.prevState).toBe(prevState)
      expect(event.nextState).toBe(nextState)
    })
  })
})
