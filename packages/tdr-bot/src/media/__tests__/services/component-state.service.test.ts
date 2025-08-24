import { EventEmitter2 } from '@nestjs/event-emitter'
import { TestingModule } from '@nestjs/testing'
import { type InteractionCollector, Message } from 'discord.js'
import { nanoid } from 'nanoid'

import {
  createMockMessage,
  createTestingModule,
} from 'src/__tests__/test-utils'
import {
  COMPONENT_CONFIG,
  ComponentLifecycleState,
} from 'src/media/component-config'
import {
  ComponentLimitExceededError,
  ComponentStateInactiveError,
  ComponentStateNotFoundError,
} from 'src/media/errors/media-errors'
import { ComponentStateService } from 'src/media/services/component-state.service'
import {
  ComponentCollectorConfig,
  CorrelationContext,
} from 'src/types/discord.types'
import { EventType, MediaType } from 'src/types/enums'

// Mock nanoid to return predictable IDs
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-session-id'),
}))

describe('ComponentStateService', () => {
  let service: ComponentStateService
  let mockEventEmitter: jest.Mocked<EventEmitter2>
  let mockMessage: jest.Mocked<Message>
  let mockCorrelationContext: CorrelationContext

  const mockCollector = {
    on: jest.fn(),
    once: jest.fn(),
    stop: jest.fn(),
    ended: false,
  }

  beforeEach(async () => {
    jest.useFakeTimers()
    jest.clearAllTimers()
    ;(nanoid as jest.Mock).mockReturnValue('test-session-id')

    const module: TestingModule = await createTestingModule([
      ComponentStateService,
    ])

    service = module.get<ComponentStateService>(ComponentStateService)
    mockEventEmitter = module.get<EventEmitter2>(
      EventEmitter2,
    ) as jest.Mocked<EventEmitter2>

    // Setup mock message with collector
    mockMessage = createMockMessage() as jest.Mocked<Message>
    mockMessage.createMessageComponentCollector.mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCollector as unknown as InteractionCollector<any>,
    )

    mockCorrelationContext = {
      correlationId: 'test-correlation-123',
      userId: 'test-user-456',
      username: 'testuser',
      guildId: 'test-guild-789',
      channelId: 'test-channel-101',
      startTime: new Date(),
      mediaType: MediaType.MOVIE,
      requestId: 'test-request-789',
    }
  })

  afterEach(async () => {
    jest.useRealTimers()
    if (service) {
      await (
        service as unknown as { onModuleDestroy?: () => Promise<void> }
      ).onModuleDestroy?.()
    }
  })

  describe('User Workflow Management', () => {
    it('should enable users to start new media search sessions', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // User should have active session for media operations
      expect(state).toMatchObject({
        userId: mockCorrelationContext.userId,
        correlationId: mockCorrelationContext.correlationId,
        state: ComponentLifecycleState.ACTIVE,
        interactionCount: 0,
        data: {},
      })

      expect(state.expiresAt.getTime()).toBeGreaterThan(Date.now())
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_CREATED,
        expect.objectContaining({
          lifecycleState: ComponentLifecycleState.ACTIVE,
        }),
      )
    })

    it('should allow users to update their search preferences and data', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // User updates search criteria
      const searchData = {
        searchQuery: 'The Matrix',
        mediaType: MediaType.MOVIE,
        page: 1,
      }
      await service.updateComponentState(state.id, searchData)

      const updatedState = service.getComponentState(state.id)
      expect(updatedState?.data).toEqual(searchData)
    })
  })

  describe('User Session Continuity', () => {
    it('should maintain user preferences across interactions', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // User sets preferences
      const preferences = {
        searchQuery: 'test movie',
        page: 1,
        filters: { year: 2020 },
      }
      await service.updateComponentState(state.id, preferences)

      // User should be able to retrieve their session with preferences intact
      const retrievedState = service.getComponentState(state.id)
      expect(retrievedState?.data).toEqual(preferences)
    })

    it('should prevent users from updating expired sessions', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Simulate session expiry
      ;(state as unknown as { state: ComponentLifecycleState }).state =
        ComponentLifecycleState.EXPIRED

      // User should get clear error when trying to use expired session
      await expect(
        service.updateComponentState(state.id, { searchTerm: 'test data' }),
      ).rejects.toThrow(ComponentStateInactiveError)

      // Non-existent sessions should also be handled gracefully
      await expect(
        service.updateComponentState('non-existent-id', {
          searchTerm: 'test data',
        }),
      ).rejects.toThrow(ComponentStateNotFoundError)
    })
  })

  describe('User Session Management', () => {
    it('should track and manage user sessions correctly', async () => {
      // Create multiple sessions for the same user
      const state1 = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      const context2 = {
        ...mockCorrelationContext,
        correlationId: 'correlation-2',
      }
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-2')
      const state2 = await service.createComponentState(mockMessage, context2)

      const userSessions = service.getUserSessions(
        mockCorrelationContext.userId,
      )
      expect(userSessions).toHaveLength(2)
      expect(userSessions.map(s => s.sessionId)).toContain(state1.sessionId)
      expect(userSessions.map(s => s.sessionId)).toContain(state2.sessionId)

      // Test filtering active sessions only
      ;(state1 as unknown as { state: ComponentLifecycleState }).state =
        ComponentLifecycleState.EXPIRED
      const activeSessions = service.getUserSessions(
        mockCorrelationContext.userId,
      )
      expect(activeSessions).toHaveLength(1)
      expect(activeSessions[0].sessionId).toBe(state2.sessionId)
    })
  })

  describe('User Resource Management', () => {
    it('should prevent users from overwhelming the system with too many sessions', async () => {
      // Fill up global capacity
      const promises = []
      for (let i = 0; i < COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL; i++) {
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
          userId: `user-${i}`,
        }
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        promises.push(service.createComponentState(mockMessage, context))
      }
      await Promise.all(promises)

      // New user should get clear error when system is at capacity
      const overLimitContext = {
        ...mockCorrelationContext,
        correlationId: 'over-limit',
        userId: 'over-limit-user',
      }
      ;(nanoid as jest.Mock).mockReturnValueOnce('over-limit-session')

      await expect(
        service.createComponentState(mockMessage, overLimitContext),
      ).rejects.toThrow(ComponentLimitExceededError)
    })

    it('should automatically manage user session limits for optimal experience', async () => {
      // User creates multiple search sessions
      const promises = []
      for (let i = 0; i < COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER; i++) {
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
        }
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        promises.push(service.createComponentState(mockMessage, context))
      }
      const states = await Promise.all(promises)

      // System should auto-cleanup oldest session when user starts new one
      ;(nanoid as jest.Mock).mockReturnValueOnce('newest-session')
      const newestContext = {
        ...mockCorrelationContext,
        correlationId: 'newest',
      }
      const newestState = await service.createComponentState(
        mockMessage,
        newestContext,
      )

      // Oldest session should be automatically cleaned up
      expect(service.getComponentState(states[0].id)).toBeUndefined()
      expect(service.getComponentState(newestState.id)).toBeDefined()
    })
  })

  describe('User Interaction Tracking', () => {
    it('should customize session timeouts based on user needs', async () => {
      const customConfig: ComponentCollectorConfig = {
        time: 30000,
        max: 10,
      }

      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        customConfig,
      )

      // Session should be configured for user's interaction pattern
      expect(state.maxInteractions).toBe(10)
      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith(
        expect.objectContaining({
          time: 30000,
          max: 10,
        }),
      )
    })

    it('should track user interactions for session management', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Simulate user interacting with component
      const mockInteraction = {
        user: { id: mockCorrelationContext.userId },
        deferred: false,
        replied: false,
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        customId: 'test-component-id',
      } as Record<string, unknown>
      const collectHandler = (
        mockCollector.on as jest.MockedFunction<typeof mockCollector.on>
      ).mock.calls.find((call: unknown[]) => call[0] === 'collect')?.[1]

      if (collectHandler) {
        await collectHandler(mockInteraction)

        // Session should reflect user activity
        const updatedState = service.getComponentState(state.id)
        expect(updatedState?.interactionCount).toBe(1)
        expect(updatedState?.lastInteractionAt).toBeInstanceOf(Date)
      }
    })
  })

  describe('Session Cleanup and User Experience', () => {
    it('should clean up user sessions when no longer needed', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // User finishes their media search workflow
      await service.cleanupComponent(state.id, 'manual')

      // Session should be completely removed
      expect(service.getComponentState(state.id)).toBeUndefined()
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_CLEANED,
        expect.objectContaining({
          stateId: state.id,
          reason: 'manual',
        }),
      )
    })

    it('should handle concurrent cleanup requests gracefully', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Multiple cleanup requests (e.g., user cancels while timeout occurs)
      const cleanup1 = service.cleanupComponent(state.id, 'manual')
      const cleanup2 = service.cleanupComponent(state.id, 'manual')

      await Promise.all([cleanup1, cleanup2])

      // Should handle gracefully without errors
      expect(service.getComponentState(state.id)).toBeUndefined()
    })
  })

  describe('User Error Handling', () => {
    it('should provide clear feedback when user sessions encounter errors', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Simulate user session error
      const errorHandler = (
        mockCollector.once as jest.MockedFunction<typeof mockCollector.once>
      ).mock.calls.find((call: unknown[]) => call[0] === 'error')?.[1]
      if (errorHandler) {
        const testError = new Error('Session error')
        errorHandler(testError)

        // User should be notified about session issues
        expect(mockEventEmitter.emit).toHaveBeenCalledWith(
          EventType.COMPONENT_ERROR,
          expect.objectContaining({
            stateId: state.id,
            error: testError,
          }),
        )
      }
    })
  })

  describe('User Activity Metrics', () => {
    it('should track user engagement for service improvement', async () => {
      const initialMetrics = service.getMetrics()

      // User starts new media search
      await service.createComponentState(mockMessage, mockCorrelationContext)

      const metricsAfterCreate = service.getMetrics()
      expect(metricsAfterCreate.totalComponents).toBe(
        initialMetrics.totalComponents + 1,
      )
      expect(metricsAfterCreate.activeComponents).toBe(
        initialMetrics.activeComponents + 1,
      )
    })
  })

  describe('High-Volume User Scenarios', () => {
    it('should handle multiple users updating search preferences simultaneously', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Multiple concurrent user preference updates
      const updatePromises = Array.from({ length: 5 }, (_, i) =>
        service.updateComponentState(state.id, {
          searchTerm: `user-search-${i}`,
          lastSearchTime: new Date(Date.now() + i),
        }),
      )

      // All user updates should complete successfully
      await expect(Promise.all(updatePromises)).resolves.toBeDefined()

      const finalState = service.getComponentState(state.id)
      expect(finalState).toBeDefined()
      expect(finalState?.data.searchTerm).toMatch(/^user-search-\d+$/)
    })

    it('should manage user sessions during high-frequency usage patterns', async () => {
      const initialMetrics = service.getMetrics()

      // Simulate rapid user session creation and completion
      for (let i = 0; i < 20; i++) {
        const context = {
          ...mockCorrelationContext,
          correlationId: `user-session-${i}`,
        }
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)

        const state = await service.createComponentState(mockMessage, context)
        await service.cleanupComponent(state.id, 'manual')
      }

      const finalMetrics = service.getMetrics()

      // System should handle rapid user workflows without issues
      expect(finalMetrics.activeComponents).toBe(
        initialMetrics.activeComponents,
      )
      expect(finalMetrics.totalComponents).toBe(
        initialMetrics.totalComponents + 20,
      )
    })
  })
})
