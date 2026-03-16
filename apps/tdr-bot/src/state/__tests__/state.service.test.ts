import { firstValueFrom, Subscription, take, toArray } from 'rxjs'

import { createTestingModule } from 'src/__tests__/test-utils'
import { AppState, StateService } from 'src/state/state.service'

describe('StateService', () => {
  let service: StateService

  beforeEach(async () => {
    const module = await createTestingModule([StateService])
    service = module.get<StateService>(StateService)
  })

  afterEach(() => {
    service.onModuleDestroy()
  })

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const state = service.getState()

      expect(state).toEqual({
        graphHistory: [],
        maxTokens: 50_000,
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o-mini',
        prompt: expect.stringContaining('kawaii'),
        temperature: 0,
      })
    })
  })

  describe('setState', () => {
    it('should update state with object', () => {
      service.setState({ maxTokens: 100_000, temperature: 0.7 })

      const state = service.getState()
      expect(state.maxTokens).toBe(100_000)
      expect(state.temperature).toBe(0.7)
      expect(state.chatModel).toBe('gpt-4-turbo')
    })

    it('should update state with function', () => {
      service.setState(prev => ({ maxTokens: prev.maxTokens * 2 }))

      expect(service.getState().maxTokens).toBe(100_000)
    })

    it('should use shallow spread (not deep merge)', () => {
      const history1 = [
        { messages: [{ content: 'a' }], images: [] },
        { messages: [{ content: 'b' }], images: [] },
      ] as unknown as AppState['graphHistory']

      service.setState({ graphHistory: history1 })
      expect(service.getState().graphHistory).toHaveLength(2)

      const history2 = [
        { messages: [{ content: 'c' }], images: [] },
      ] as unknown as AppState['graphHistory']

      service.setState({ graphHistory: history2 })
      expect(service.getState().graphHistory).toHaveLength(1)
      expect(service.getState().graphHistory[0].messages[0].content).toBe('c')
    })
  })

  describe('getState', () => {
    it('should return current state', () => {
      expect(service.getState().temperature).toBe(0)
      service.setState({ temperature: 0.5 })
      expect(service.getState().temperature).toBe(0.5)
    })
  })

  describe('select', () => {
    it('should emit only when selected value changes', async () => {
      const values: number[] = []

      const sub = service
        .select(s => s.temperature)
        .pipe(take(3))
        .subscribe((v: number) => values.push(v))

      service.setState({ temperature: 0.5 })
      service.setState({ maxTokens: 999 })
      service.setState({ temperature: 0.8 })

      sub.unsubscribe()

      expect(values).toEqual([0, 0.5, 0.8])
    })

    it('should use custom comparator for distinctUntilChanged', async () => {
      const values: number[] = []

      // Custom comparator: treat values within 0.1 of each other as equal (no emit)
      const sub: Subscription = service
        .select(
          s => s.temperature,
          (a, b) => Math.abs(a - b) < 0.1,
        )
        .subscribe((v: number) => values.push(v))

      service.setState({ temperature: 0.05 }) // within 0.1 of 0 — suppressed
      service.setState({ temperature: 0.5 }) // differs by >0.1 — emitted
      service.setState({ temperature: 0.55 }) // within 0.1 of 0.5 — suppressed
      service.setState({ temperature: 1.0 }) // differs by >0.1 — emitted

      sub.unsubscribe()

      expect(values).toEqual([0, 0.5, 1.0])
    })
  })

  describe('changes$', () => {
    it('should emit on every state change', async () => {
      const promise = firstValueFrom(service.changes$.pipe(take(3), toArray()))

      service.setState({ temperature: 0.1 })
      service.setState({ temperature: 0.2 })

      const states = await promise
      expect(states).toHaveLength(3)
      expect(states[0].temperature).toBe(0)
      expect(states[1].temperature).toBe(0.1)
      expect(states[2].temperature).toBe(0.2)
    })
  })

  describe('complex state management', () => {
    it('should handle multiple sequential updates', () => {
      service.setState({ temperature: 0.3 })
      service.setState({ maxTokens: 75_000 })
      service.setState(state => ({
        chatModel: state.temperature > 0.5 ? 'gpt-4' : 'gpt-3.5-turbo',
      }))

      expect(service.getState()).toMatchObject({
        temperature: 0.3,
        maxTokens: 75_000,
        chatModel: 'gpt-3.5-turbo',
      })
    })

    it('should preserve graph history when updating other fields', () => {
      const history = [
        { messages: [{ content: 'msg1' }], images: ['img1'] },
        { messages: [{ content: 'msg2' }], images: ['img2'] },
      ] as unknown as AppState['graphHistory']

      service.setState({ graphHistory: history })
      service.setState({ temperature: 0.8 })

      const state = service.getState()
      expect(state.graphHistory).toEqual(history)
      expect(state.temperature).toBe(0.8)
    })
  })
})
