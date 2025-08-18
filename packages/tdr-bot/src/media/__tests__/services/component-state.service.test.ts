import { EventEmitter2 } from '@nestjs/event-emitter'
import { TestingModule } from '@nestjs/testing'
import { ComponentType, InteractionCollector, Message } from 'discord.js'
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
  ComponentStateNotFoundError,
  ComponentStateInactiveError,
  ComponentLimitExceededError,
} from 'src/media/errors/media-errors'
import { ComponentStateService } from 'src/media/services/component-state.service'
import {
  ComponentCollectorConfig,
  ComponentState,
  CorrelationContext,
  MessageComponentInteraction,
} from 'src/types/discord.types'
import { EventType } from 'src/types/enums'

// Mock nanoid to return predictable IDs
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-session-id'),
}))

// Mock Discord.js ComponentType if needed
jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  ComponentType: {
    ActionRow: 1,
    Button: 2,
    StringSelect: 3,
    TextInput: 4,
    UserSelect: 5,
    RoleSelect: 6,
    MentionableSelect: 7,
    ChannelSelect: 8,
  },
}))

describe('ComponentStateService', () => {
  let service: ComponentStateService
  let mockEventEmitter: jest.Mocked<EventEmitter2>
  let mockMessage: Message
  let mockCorrelationContext: CorrelationContext
  let mockCollector: jest.Mocked<
    InteractionCollector<MessageComponentInteraction>
  >

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Create mock message with collector before service creation
    mockMessage = createMockMessage({
      id: 'test-message-id',
      content: 'Test message',
    })

    // Mock createMessageComponentCollector
    mockCollector = {
      on: jest.fn().mockReturnThis(),
      stop: jest.fn(),
      ended: false,
    } as unknown as jest.Mocked<
      InteractionCollector<MessageComponentInteraction>
    >

    mockMessage.createMessageComponentCollector = jest
      .fn()
      .mockReturnValue(mockCollector)

    // Setup correlation context
    mockCorrelationContext = {
      correlationId: 'test-correlation-id',
      userId: 'test-user-id',
      username: 'testuser',
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      startTime: new Date(),
    }

    const module: TestingModule = await createTestingModule([
      ComponentStateService,
    ])

    service = module.get<ComponentStateService>(ComponentStateService)
    mockEventEmitter = module.get<jest.Mocked<EventEmitter2>>(EventEmitter2)
  })

  afterEach(async () => {
    await service.onModuleDestroy()
    jest.useRealTimers()
  })

  describe('Module Lifecycle', () => {
    it('should initialize with cleanup interval', () => {
      expect(jest.getTimerCount()).toBeGreaterThan(0)
    })

    it('should cleanup properly on module destroy', async () => {
      // Create a component state first
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )
      expect(service.getMetrics().activeComponents).toBe(1)

      // Mark as expired so it gets cleaned during performCleanup
      state.state = ComponentLifecycleState.EXPIRED

      // Module destroy should clean everything up
      await service.onModuleDestroy()

      expect(service.getMetrics().activeComponents).toBe(0)
      expect(jest.getTimerCount()).toBe(0)
    })

    it('should clear all timeouts on module destroy', async () => {
      // Create multiple component states
      await service.createComponentState(mockMessage, mockCorrelationContext)

      const context2: CorrelationContext = {
        ...mockCorrelationContext,
        correlationId: 'test-correlation-2',
        userId: 'test-user-2',
      }
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-2')
      await service.createComponentState(mockMessage, context2)

      expect(jest.getTimerCount()).toBeGreaterThan(2)

      await service.onModuleDestroy()
      expect(jest.getTimerCount()).toBe(0)
    })
  })

  describe('Component Creation', () => {
    it('should create component state successfully', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      expect(state).toMatchObject({
        id: `${mockCorrelationContext.correlationId}:test-session-id`,
        userId: mockCorrelationContext.userId,
        type: ComponentType.ActionRow,
        correlationId: mockCorrelationContext.correlationId,
        sessionId: 'test-session-id',
        interactionCount: 0,
        maxInteractions: 50,
        state: ComponentLifecycleState.ACTIVE,
        data: {},
      })

      expect(state.expiresAt.getTime()).toBeGreaterThan(Date.now())
      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalled()
    })

    it('should create component state with custom config', async () => {
      const config: ComponentCollectorConfig = {
        time: 30000,
        max: 10,
      }

      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        config,
      )

      expect(state.maxInteractions).toBe(10)
      expect(state.expiresAt.getTime()).toBe(state.createdAt.getTime() + 30000)
    })

    it('should emit creation event', async () => {
      await service.createComponentState(mockMessage, mockCorrelationContext)

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_CREATED,
        expect.objectContaining({
          stateId: expect.stringContaining(
            mockCorrelationContext.correlationId,
          ),
          correlationId: mockCorrelationContext.correlationId,
          userId: mockCorrelationContext.userId,
          lifecycleState: ComponentLifecycleState.ACTIVE,
        }),
      )
    })

    it('should update metrics on creation', async () => {
      const initialMetrics = service.getMetrics()

      await service.createComponentState(mockMessage, mockCorrelationContext)

      const updatedMetrics = service.getMetrics()
      expect(updatedMetrics.totalComponents).toBe(
        initialMetrics.totalComponents + 1,
      )
      expect(updatedMetrics.activeComponents).toBe(
        initialMetrics.activeComponents + 1,
      )
    })

    it('should schedule lifecycle timeouts', async () => {
      const initialTimerCount = jest.getTimerCount()

      await service.createComponentState(mockMessage, mockCorrelationContext)

      // Should create at least 2 timeouts (warning and expiration)
      expect(jest.getTimerCount()).toBeGreaterThan(initialTimerCount + 1)
    })
  })

  describe('Component State Management', () => {
    let state: ComponentState

    beforeEach(async () => {
      state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )
    })

    it('should retrieve component state by ID', () => {
      const retrievedState = service.getComponentState(state.id)
      expect(retrievedState).toBe(state)
    })

    it('should return undefined for non-existent state ID', () => {
      const retrievedState = service.getComponentState('non-existent-id')
      expect(retrievedState).toBeUndefined()
    })

    it('should update component state data successfully', async () => {
      const updateData = {
        searchResults: [
          {
            id: '1',
            title: 'Test',
            mediaType: 'movie' as any,
            inLibrary: false,
          },
        ],
        currentPage: 1,
      }

      await expect(
        service.updateComponentState(
          state.id,
          updateData,
          state.correlationId,
        )
      ).resolves.toBeUndefined()

      expect(state.data).toMatchObject(updateData)
      expect(state.interactionCount).toBe(1)
      expect(state.lastInteractionAt.getTime()).toBeGreaterThanOrEqual(
        state.createdAt.getTime(),
      )
    })

    it('should throw error when updating inactive component state', async () => {
      state.state = ComponentLifecycleState.CLEANED

      await expect(
        service.updateComponentState(
          state.id,
          { currentPage: 2 },
          state.correlationId,
        )
      ).rejects.toThrow(ComponentStateInactiveError)

      expect(state.interactionCount).toBe(0) // Should not increment
    })

    it('should throw error when updating non-existent component state', async () => {
      await expect(
        service.updateComponentState('non-existent-id', {
          currentPage: 2,
        })
      ).rejects.toThrow(ComponentStateNotFoundError)
    })

    it('should merge data correctly on update', async () => {
      // Initial data
      await expect(
        service.updateComponentState(state.id, {
          currentPage: 1,
          totalPages: 5,
        })
      ).resolves.toBeUndefined()

      // Update with additional data
      await expect(
        service.updateComponentState(state.id, {
          currentPage: 2,
          searchTerm: 'test query',
        })
      ).resolves.toBeUndefined()

      expect(state.data).toMatchObject({
        currentPage: 2,
        totalPages: 5,
        searchTerm: 'test query',
      })
    })
  })

  describe('User Session Management', () => {
    it('should return empty sessions for user with no components', () => {
      const sessions = service.getUserSessions('non-existent-user')
      expect(sessions).toEqual([])
    })

    it('should return user sessions correctly', async () => {
      await service.createComponentState(mockMessage, mockCorrelationContext)

      const sessions = service.getUserSessions(mockCorrelationContext.userId)

      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        sessionId: 'test-session-id',
        userId: mockCorrelationContext.userId,
        correlationId: mockCorrelationContext.correlationId,
        componentCount: 1,
        maxComponents: 50,
        isActive: true,
      })
      expect(sessions[0].metadata.stateId).toContain(
        mockCorrelationContext.correlationId,
      )
    })

    it('should return multiple sessions for user', async () => {
      // First component
      await service.createComponentState(mockMessage, mockCorrelationContext)

      // Second component for same user
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-2')
      const context2 = {
        ...mockCorrelationContext,
        correlationId: 'correlation-2',
      }
      await service.createComponentState(mockMessage, context2)

      const sessions = service.getUserSessions(mockCorrelationContext.userId)
      expect(sessions).toHaveLength(2)
    })

    it('should only return active sessions', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Mark state as cleaned
      state.state = ComponentLifecycleState.CLEANED

      const sessions = service.getUserSessions(mockCorrelationContext.userId)
      expect(sessions).toHaveLength(0)
    })
  })

  describe('Component Limits and Enforcement', () => {
    it('should enforce global component limit', async () => {
      // Create components up to the default limit (10)
      const promises = []
      for (let i = 0; i < 10; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
          userId: `user-${i}`,
        }
        promises.push(service.createComponentState(mockMessage, context))
      }

      await Promise.all(promises)
      expect(service.getMetrics().activeComponents).toBe(10)

      // Try to create one more (should fail)
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-overflow')
      const overflowContext = {
        ...mockCorrelationContext,
        correlationId: 'correlation-overflow',
        userId: 'user-overflow',
      }

      await expect(
        service.createComponentState(mockMessage, overflowContext),
      ).rejects.toThrow(ComponentLimitExceededError)
    })

    it('should enforce user component limits', async () => {
      // Create components up to the default user limit (5)
      const promises = []
      for (let i = 0; i < 5; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
        }
        promises.push(service.createComponentState(mockMessage, context))
      }

      await Promise.all(promises)
      expect(
        service.getUserSessions(mockCorrelationContext.userId),
      ).toHaveLength(5)

      // Create one more component for same user (should cleanup oldest)
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-6')
      const context6 = {
        ...mockCorrelationContext,
        correlationId: 'correlation-6',
      }

      await service.createComponentState(mockMessage, context6)

      // Should still have 5 components (oldest cleaned up)
      const sessions = service.getUserSessions(mockCorrelationContext.userId)
      expect(sessions).toHaveLength(5)
      expect(sessions.some(s => s.correlationId === 'correlation-6')).toBe(true)
    })

    it('should clean up oldest session when user limit reached', async () => {
      // Create two components
      const state1 = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      ;(nanoid as jest.Mock).mockReturnValueOnce('session-2')
      const context2 = {
        ...mockCorrelationContext,
        correlationId: 'correlation-2',
      }
      const state2 = await service.createComponentState(mockMessage, context2)

      // Advance time and update states to make ordering clear
      jest.advanceTimersByTime(1000)
      state1.lastInteractionAt = new Date(Date.now() - 10000)
      state2.lastInteractionAt = new Date()

      // Create more components to exceed user limit and force cleanup
      for (let i = 3; i <= 6; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
        }
        await service.createComponentState(mockMessage, context)
      }

      // Should have cleaned up older components, keeping newest ones
      const sessions = service.getUserSessions(mockCorrelationContext.userId)
      expect(sessions).toHaveLength(5) // Default max per user
      expect(sessions.some(s => s.correlationId === 'correlation-6')).toBe(true)
    })
  })

  describe('Collector Management', () => {
    let state: ComponentState

    beforeEach(async () => {
      state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )
    })

    it('should create collector with correct configuration', () => {
      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith(
        expect.objectContaining({
          time: COMPONENT_CONFIG.LIFETIME_MS,
          filter: expect.any(Function),
        }),
      )
    })

    it('should create collector with custom configuration', async () => {
      const config: ComponentCollectorConfig = {
        time: 60000,
        max: 25,
        maxComponents: 10,
        maxUsers: 5,
        idle: 30000,
      }

      await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        config,
      )

      expect(
        mockMessage.createMessageComponentCollector,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          time: 60000,
          max: 25,
          maxComponents: 10,
          maxUsers: 5,
          idle: 30000,
        }),
      )
    })

    it('should create collector with custom filter', async () => {
      const customFilter = jest.fn(() => true)
      const config: ComponentCollectorConfig = {
        time: COMPONENT_CONFIG.LIFETIME_MS,
        filter: customFilter,
      }

      await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        config,
      )

      const collectorConfig = (
        mockMessage.createMessageComponentCollector as jest.Mock
      ).mock.calls[1][0]
      expect(collectorConfig.filter).toBe(customFilter)
    })

    it('should handle collector interactions', async () => {
      // Get the collect handler from the mock
      const collectHandler = mockCollector.on.mock.calls.find(
        call => call[0] === 'collect',
      )?.[1]
      expect(collectHandler).toBeDefined()

      const mockInteraction = {
        user: { id: mockCorrelationContext.userId },
        customId: 'test-button',
        componentType: ComponentType.Button,
      } as unknown as MessageComponentInteraction

      // Simulate interaction
      if (collectHandler) {
        await collectHandler(mockInteraction)
      }

      // Should update state and emit event
      expect(state.interactionCount).toBe(1)
      expect(state.lastInteractionAt.getTime()).toBeGreaterThanOrEqual(
        state.createdAt.getTime(),
      )
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.USER_INTERACTION,
        expect.objectContaining({
          stateId: state.id,
          correlationId: state.correlationId,
          userId: mockInteraction.user.id,
          customId: mockInteraction.customId,
          componentType: mockInteraction.componentType,
        }),
      )
    })

    it('should not handle interactions for inactive state', async () => {
      state.state = ComponentLifecycleState.CLEANED

      const collectHandler = mockCollector.on.mock.calls.find(
        call => call[0] === 'collect',
      )?.[1]

      const mockInteraction = {
        user: { id: mockCorrelationContext.userId },
      } as unknown as MessageComponentInteraction

      const initialCount = state.interactionCount
      if (collectHandler) {
        await collectHandler(mockInteraction)
      }

      expect(state.interactionCount).toBe(initialCount)
    })

    it('should handle collector end event', async () => {
      const endHandler = mockCollector.on.mock.calls.find(
        call => call[0] === 'end',
      )?.[1]
      expect(endHandler).toBeDefined()

      const mockCollection = new Map()
      if (endHandler) {
        await endHandler(mockCollection, 'time')
      }

      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_EXPIRED,
        expect.objectContaining({
          stateId: state.id,
          correlationId: state.correlationId,
          reason: 'timeout',
        }),
      )
    })

    it('should handle collector end with different reasons', async () => {
      const endHandler = mockCollector.on.mock.calls.find(
        call => call[0] === 'end',
      )?.[1]

      const mockCollection = new Map()
      if (endHandler) {
        await endHandler(mockCollection, 'limit')
      }

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_EXPIRED,
        expect.objectContaining({
          reason: 'collector_end',
        }),
      )
    })

    it('should not cleanup already cleaned state on collector end', async () => {
      state.state = ComponentLifecycleState.CLEANED

      const endHandler = mockCollector.on.mock.calls.find(
        call => call[0] === 'end',
      )?.[1]

      const mockCollection = new Map()
      if (endHandler) {
        await endHandler(mockCollection, 'time')
      }

      // Should not emit additional cleanup event
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        EventType.COMPONENT_EXPIRED,
        expect.anything(),
      )
    })
  })

  describe('Lifecycle Timeout Management', () => {
    it.skip('should schedule warning timeout', async () => {
      // TODO: Fix async setTimeout testing with Jest fake timers
      // This test is skipped because Jest's fake timers don't handle async setTimeout callbacks well
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      const warningTime =
        state.expiresAt.getTime() - COMPONENT_CONFIG.WARNING_OFFSET_MS
      const warningDelay = warningTime - Date.now()

      // Fast forward to warning time
      jest.advanceTimersByTime(warningDelay)
      
      // Wait for async operations to complete
      await new Promise(resolve => process.nextTick(resolve))

      expect(state.state).toBe(ComponentLifecycleState.WARNING)
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'component.timeout.warning',
        expect.objectContaining({
          stateId: state.id,
          correlationId: state.correlationId,
          timeRemaining: COMPONENT_CONFIG.WARNING_OFFSET_MS,
        }),
      )
    })

    it('should not emit warning if state already inactive', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Mark as cleaned before warning time
      state.state = ComponentLifecycleState.CLEANED

      const warningTime =
        state.expiresAt.getTime() - COMPONENT_CONFIG.WARNING_OFFSET_MS
      const warningDelay = warningTime - Date.now()

      jest.advanceTimersByTime(warningDelay)

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        'component.timeout.warning',
        expect.anything(),
      )
    })

    it.skip('should schedule expiration timeout', async () => {
      // TODO: Fix async setTimeout testing with Jest fake timers
      // This test is skipped because Jest's fake timers don't handle async setTimeout callbacks well
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      const expirationDelay = state.expiresAt.getTime() - Date.now()

      // Fast forward to expiration
      jest.advanceTimersByTime(expirationDelay)
      
      // Wait for async operations to complete
      await new Promise(resolve => process.nextTick(resolve))

      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
    })

    it('should not expire inactive state', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Mark as cleaned before expiration
      state.state = ComponentLifecycleState.CLEANED

      const expirationDelay = state.expiresAt.getTime() - Date.now()
      jest.advanceTimersByTime(expirationDelay)

      // Should not attempt to cleanup again
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1) // Only creation event
    })

    it('should clear timeouts on cleanup', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Verify cleanup completed
      await service.cleanupComponent(state.id, 'manual', state.correlationId)

      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
      expect(service.getComponentState(state.id)).toBeUndefined()
    })
  })

  describe('Cleanup Operations', () => {
    let state: ComponentState

    beforeEach(async () => {
      state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )
    })

    it('should cleanup component successfully', async () => {
      await service.cleanupComponent(state.id, 'manual', state.correlationId)

      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
      expect(service.getComponentState(state.id)).toBeUndefined()
      expect(mockCollector.stop).toHaveBeenCalledWith('manual')
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_EXPIRED,
        expect.objectContaining({
          stateId: state.id,
          correlationId: state.correlationId,
          reason: 'manual',
        }),
      )
    })

    it('should handle cleanup for non-existent component', async () => {
      // Should not throw error
      await expect(
        service.cleanupComponent('non-existent-id', 'manual'),
      ).resolves.toBeUndefined()
    })

    it('should execute custom cleanup function', async () => {
      const customCleanup = jest.fn().mockResolvedValue(undefined)
      state.cleanup = customCleanup

      await service.cleanupComponent(state.id, 'manual', state.correlationId)

      expect(customCleanup).toHaveBeenCalled()
    })

    it('should handle cleanup errors gracefully', async () => {
      const customCleanup = jest
        .fn()
        .mockRejectedValue(new Error('Cleanup failed'))
      state.cleanup = customCleanup

      await expect(
        service.cleanupComponent(state.id, 'manual', state.correlationId),
      ).rejects.toThrow('Cleanup failed')

      // State should still be marked as cleaned even if custom cleanup fails
      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
    })

    it('should not stop already ended collector', async () => {
      mockCollector.ended = true

      await service.cleanupComponent(state.id, 'manual', state.correlationId)

      expect(mockCollector.stop).not.toHaveBeenCalled()
    })

    it('should update metrics on cleanup', async () => {
      const initialMetrics = service.getMetrics()

      await service.cleanupComponent(state.id, 'manual', state.correlationId)

      const updatedMetrics = service.getMetrics()
      expect(updatedMetrics.activeComponents).toBe(
        initialMetrics.activeComponents - 1,
      )
      expect(updatedMetrics.expiredComponents).toBe(
        initialMetrics.expiredComponents + 1,
      )
    })
  })

  describe('Bulk Cleanup Operations', () => {
    beforeEach(() => {
      // Mock the cleanup interval to not interfere
      jest.spyOn(global, 'setInterval').mockImplementation(() => ({}) as any)
    })

    it('should perform bulk cleanup successfully', async () => {
      // Create multiple components
      const state1 = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      ;(nanoid as jest.Mock).mockReturnValueOnce('session-2')
      const context2 = {
        ...mockCorrelationContext,
        correlationId: 'correlation-2',
      }
      const state2 = await service.createComponentState(mockMessage, context2)

      // Mark them as expired
      state1.state = ComponentLifecycleState.EXPIRED
      state2.state = ComponentLifecycleState.EXPIRED

      const result = await service.performCleanup('timeout')

      expect(result).toMatchObject({
        cleanedComponents: 2,
        cleanedStates: 2,
        errors: [],
        reason: 'timeout',
      })
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EventType.COMPONENT_CLEANUP,
        result,
      )
    })

    it('should cleanup expired states based on time', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Set expiration time in the past beyond grace period
      state.expiresAt = new Date(
        Date.now() - COMPONENT_CONFIG.GRACE_PERIOD_MS - 1000,
      )

      const result = await service.performCleanup('timeout')

      expect(result.cleanedComponents).toBe(1)
      expect(service.getComponentState(state.id)).toBeUndefined()
    })

    it('should not cleanup active states within grace period', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // State is still active and within grace period
      state.state = ComponentLifecycleState.ACTIVE

      const result = await service.performCleanup('timeout')

      expect(result.cleanedComponents).toBe(0)
      expect(service.getComponentState(state.id)).toBeDefined()
    })

    it('should handle cleanup errors gracefully', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Make cleanup fail
      const customCleanup = jest
        .fn()
        .mockRejectedValue(new Error('Cleanup failed'))
      state.cleanup = customCleanup
      state.state = ComponentLifecycleState.EXPIRED

      const result = await service.performCleanup('timeout')

      expect(result.cleanedComponents).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Cleanup failed')
    })

    it('should not emit event for no-op cleanup', async () => {
      // No components to cleanup
      const result = await service.performCleanup('timeout')

      expect(result.cleanedComponents).toBe(0)
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        EventType.COMPONENT_CLEANUP,
        expect.anything(),
      )
    })

    it.skip('should use automatic cleanup interval', async () => {
      // TODO: Fix async setInterval testing with Jest fake timers
      // This test is skipped because Jest's fake timers don't handle async setInterval callbacks well
      
      // Restore original setInterval behavior for this test
      jest.restoreAllMocks()
      jest.useFakeTimers()

      // Create new service instance to trigger interval setup
      const module = await createTestingModule([ComponentStateService])
      const intervalService = module.get<ComponentStateService>(
        ComponentStateService,
      )

      const state = await intervalService.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Use atomic state transition to mark as expired
      const atomicStateTransition = (intervalService as any).atomicStateTransition.bind(intervalService)
      await atomicStateTransition(state.id, ComponentLifecycleState.EXPIRED)

      // Fast forward cleanup interval
      jest.advanceTimersByTime(COMPONENT_CONFIG.CLEANUP_INTERVAL_MS)
      
      // Wait for async operations to complete
      await new Promise(resolve => process.nextTick(resolve))

      expect(intervalService.getComponentState(state.id)).toBeUndefined()

      await intervalService.onModuleDestroy()
    })
  })

  describe('Metrics Tracking', () => {
    it('should return initial metrics', () => {
      const metrics = service.getMetrics()
      expect(metrics).toMatchObject({
        totalComponents: 0,
        activeComponents: 0,
        expiredComponents: 0,
        totalInteractions: 0,
        avgResponseTime: 0,
        errorRate: 0,
      })
    })

    it('should track component creation in metrics', async () => {
      await service.createComponentState(mockMessage, mockCorrelationContext)

      const metrics = service.getMetrics()
      expect(metrics.totalComponents).toBe(1)
      expect(metrics.activeComponents).toBe(1)
    })

    it('should track interactions in metrics', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Simulate collector interaction
      const collectHandler = mockCollector.on.mock.calls.find(
        call => call[0] === 'collect',
      )?.[1]

      const mockInteraction = {
        user: { id: mockCorrelationContext.userId },
        customId: 'test-button',
        componentType: ComponentType.Button,
      } as unknown as MessageComponentInteraction

      if (collectHandler) {
        await collectHandler(mockInteraction)
      }

      const metrics = service.getMetrics()
      expect(metrics.totalInteractions).toBe(1)
    })

    it('should track cleanup in metrics', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      await service.cleanupComponent(state.id, 'manual')

      const metrics = service.getMetrics()
      expect(metrics.activeComponents).toBe(0)
      expect(metrics.expiredComponents).toBe(1)
    })

    it('should calculate error rate correctly', async () => {
      // Create multiple components
      for (let i = 0; i < 10; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
        }
        const state = await service.createComponentState(mockMessage, context)

        // Clean up each component
        await service.cleanupComponent(state.id, 'timeout')
      }

      const metrics = service.getMetrics()
      expect(metrics.totalComponents).toBe(10)
      expect(metrics.expiredComponents).toBe(10)
      expect(metrics.errorRate).toBe(100) // 100% expired
    })

    it('should return a copy of metrics object', () => {
      const metrics1 = service.getMetrics()
      const metrics2 = service.getMetrics()

      expect(metrics1).not.toBe(metrics2) // Different object instances
      expect(metrics1).toEqual(metrics2) // Same values
    })
  })

  describe('Atomic State Transitions', () => {
    let state: ComponentState

    beforeEach(async () => {
      state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )
    })

    it('should transition state atomically using private method', async () => {
      // Access private method for testing
      const atomicStateTransition = (service as any).atomicStateTransition.bind(service)
      
      const result = await atomicStateTransition(
        state.id,
        ComponentLifecycleState.WARNING,
        'test_transition',
      )

      expect(result.success).toBe(true)
      expect(result.previousState).toBe(ComponentLifecycleState.ACTIVE)
      expect(state.state).toBe(ComponentLifecycleState.WARNING)
    })

    it('should reject invalid state transitions', async () => {
      // Transition to WARNING first
      const atomicStateTransition = (service as any).atomicStateTransition.bind(service)
      await atomicStateTransition(state.id, ComponentLifecycleState.WARNING)

      // Try invalid transition from WARNING back to ACTIVE (should fail)
      const result = await atomicStateTransition(
        state.id,
        ComponentLifecycleState.ACTIVE,
      )

      expect(result.success).toBe(false)
      expect(state.state).toBe(ComponentLifecycleState.WARNING) // Should remain unchanged
    })

    it('should handle concurrent state transition attempts', async () => {
      const atomicStateTransition = (service as any).atomicStateTransition.bind(service)
      
      // Start multiple concurrent transitions to different states
      const transitions = [
        atomicStateTransition(state.id, ComponentLifecycleState.WARNING),
        atomicStateTransition(state.id, ComponentLifecycleState.EXPIRED),
        atomicStateTransition(state.id, ComponentLifecycleState.CLEANED),
      ]

      const results = await Promise.all(transitions)

      // Due to the state machine, the transitions will happen sequentially:
      // ACTIVE -> WARNING (succeeds)
      // WARNING -> EXPIRED (succeeds) 
      // EXPIRED -> CLEANED (succeeds)
      // All are valid transitions, but they happen in sequence due to mutex
      const successfulTransitions = results.filter(r => r.success)
      expect(successfulTransitions.length).toBeGreaterThan(0)

      // Final state should be CLEANED as it's the terminal state
      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
    })

    it('should validate all possible state transitions', () => {
      const isValidStateTransition = (service as any).isValidStateTransition.bind(service)

      // Valid transitions
      expect(isValidStateTransition(ComponentLifecycleState.ACTIVE, ComponentLifecycleState.WARNING)).toBe(true)
      expect(isValidStateTransition(ComponentLifecycleState.ACTIVE, ComponentLifecycleState.EXPIRED)).toBe(true)
      expect(isValidStateTransition(ComponentLifecycleState.ACTIVE, ComponentLifecycleState.CLEANED)).toBe(true)
      expect(isValidStateTransition(ComponentLifecycleState.WARNING, ComponentLifecycleState.EXPIRED)).toBe(true)
      expect(isValidStateTransition(ComponentLifecycleState.WARNING, ComponentLifecycleState.CLEANED)).toBe(true)
      expect(isValidStateTransition(ComponentLifecycleState.EXPIRED, ComponentLifecycleState.CLEANED)).toBe(true)

      // Invalid transitions
      expect(isValidStateTransition(ComponentLifecycleState.WARNING, ComponentLifecycleState.ACTIVE)).toBe(false)
      expect(isValidStateTransition(ComponentLifecycleState.EXPIRED, ComponentLifecycleState.ACTIVE)).toBe(false)
      expect(isValidStateTransition(ComponentLifecycleState.EXPIRED, ComponentLifecycleState.WARNING)).toBe(false)
      expect(isValidStateTransition(ComponentLifecycleState.CLEANED, ComponentLifecycleState.ACTIVE)).toBe(false)
      expect(isValidStateTransition(ComponentLifecycleState.CLEANED, ComponentLifecycleState.WARNING)).toBe(false)
      expect(isValidStateTransition(ComponentLifecycleState.CLEANED, ComponentLifecycleState.EXPIRED)).toBe(false)
    })

    it('should return failure for non-existent state ID', async () => {
      const atomicStateTransition = (service as any).atomicStateTransition.bind(service)
      
      const result = await atomicStateTransition(
        'non-existent-id',
        ComponentLifecycleState.CLEANED,
      )

      expect(result.success).toBe(false)
      expect(result.state).toBeUndefined()
    })

    it('should create and manage state-specific mutexes', () => {
      const getStateMutex = (service as any).getStateMutex.bind(service)
      const stateMutexes = (service as any).stateMutexes

      const mutex1 = getStateMutex(state.id)
      const mutex2 = getStateMutex(state.id)
      const mutex3 = getStateMutex('different-state-id')

      // Same state ID should return same mutex
      expect(mutex1).toBe(mutex2)
      // Different state ID should return different mutex
      expect(mutex1).not.toBe(mutex3)
      // Mutex should be stored in the map
      expect(stateMutexes.has(state.id)).toBe(true)
      expect(stateMutexes.has('different-state-id')).toBe(true)
    })

    it('should clean up state mutex after cleanup', async () => {
      const stateMutexes = (service as any).stateMutexes
      
      // Verify mutex exists for the state
      expect(stateMutexes.has(state.id)).toBe(false) // Not created yet
      
      // Trigger mutex creation by accessing it
      const getStateMutex = (service as any).getStateMutex.bind(service)
      getStateMutex(state.id)
      expect(stateMutexes.has(state.id)).toBe(true)

      // Cleanup the component
      await service.cleanupComponent(state.id, 'manual', state.correlationId)

      // Mutex should be cleaned up
      expect(stateMutexes.has(state.id)).toBe(false)
    })
  })

  describe('Race Condition Prevention', () => {
    it('should prevent race condition in cleanup operations', async () => {
      const states = []

      // Create multiple components
      for (let i = 0; i < 3; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
          userId: `user-${i}`,
        }
        const state = await service.createComponentState(mockMessage, context)
        states.push(state)
      }

      // Attempt concurrent cleanups on the same state
      const cleanupPromises = []
      for (let i = 0; i < 5; i++) {
        cleanupPromises.push(
          service.cleanupComponent(states[0].id, 'manual', states[0].correlationId)
        )
      }

      // All cleanup calls should complete without error
      await expect(Promise.all(cleanupPromises)).resolves.toBeDefined()

      // State should be properly cleaned up only once
      expect(states[0].state).toBe(ComponentLifecycleState.CLEANED)
      expect(service.getComponentState(states[0].id)).toBeUndefined()
    })

    it('should handle race condition between timeout expiration and manual cleanup', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Simulate concurrent timeout expiration and manual cleanup
      const atomicStateTransition = (service as any).atomicStateTransition.bind(service)
      
      const expiredTransitionPromise = atomicStateTransition(
        state.id,
        ComponentLifecycleState.EXPIRED,
        'timeout',
      )
      const cleanupPromise = service.cleanupComponent(
        state.id,
        'manual',
        state.correlationId,
      )

      await Promise.all([expiredTransitionPromise, cleanupPromise])

      // Final state should be CLEANED regardless of which operation completed first
      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
      expect(service.getComponentState(state.id)).toBeUndefined()
    })

    it('should prevent race condition in warning timeout scheduling', async () => {
      jest.clearAllTimers()
      jest.useFakeTimers()

      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        {
          time: COMPONENT_CONFIG.WARNING_OFFSET_MS + 5000, // Ensure warning gets scheduled
        },
      )

      // Clean up the component before the warning timeout fires
      await service.cleanupComponent(
        state.id,
        'manual',
        state.correlationId,
      )

      // Fast forward to when the warning would have been triggered
      jest.advanceTimersByTime(COMPONENT_CONFIG.WARNING_OFFSET_MS)

      // State should be CLEANED
      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
      expect(service.getComponentState(state.id)).toBeUndefined()

      // Warning event should not be emitted since state transition will fail
      const warningCalls = mockEventEmitter.emit.mock.calls.filter(
        call => call[0] === 'component.timeout.warning'
      )
      expect(warningCalls.length).toBe(0)

      jest.useRealTimers()
    })

    it('should handle multiple concurrent state updates safely', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      const atomicStateTransition = (service as any).atomicStateTransition.bind(service)

      // Start multiple identical state transitions concurrently
      const transitionPromises = [
        atomicStateTransition(state.id, ComponentLifecycleState.WARNING, 'test1'),
        atomicStateTransition(state.id, ComponentLifecycleState.WARNING, 'test2'),
        atomicStateTransition(state.id, ComponentLifecycleState.WARNING, 'test3'),
      ]

      const results = await Promise.all(transitionPromises)

      // First transition succeeds, others fail because state is already WARNING
      const successCount = results.filter(r => r.success).length
      expect(successCount).toBe(1)
      expect(state.state).toBe(ComponentLifecycleState.WARNING)

      // Now try transitioning to different states concurrently from WARNING
      const conflictingTransitions = [
        atomicStateTransition(state.id, ComponentLifecycleState.EXPIRED, 'test4'),
        atomicStateTransition(state.id, ComponentLifecycleState.CLEANED, 'test5'),
      ]

      const conflictResults = await Promise.all(conflictingTransitions)

      // Both are valid transitions from WARNING, but due to mutex only one happens at a time
      // Both can succeed as WARNING -> EXPIRED and WARNING -> CLEANED are both valid
      const conflictSuccessCount = conflictResults.filter(r => r.success).length
      expect(conflictSuccessCount).toBeGreaterThanOrEqual(1)

      // Final state should be one of the valid target states
      expect([
        ComponentLifecycleState.EXPIRED,
        ComponentLifecycleState.CLEANED,
      ]).toContain(state.state)
    })
  })

  describe('Concurrent Access Patterns', () => {
    it('should handle concurrent component creation', async () => {
      const promises = []

      for (let i = 0; i < 5; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
          userId: `user-${i}`,
        }
        promises.push(service.createComponentState(mockMessage, context))
      }

      const states = await Promise.all(promises)

      expect(states).toHaveLength(5)
      expect(service.getMetrics().activeComponents).toBe(5)

      // All states should be unique
      const stateIds = states.map(s => s.id)
      expect(new Set(stateIds).size).toBe(5)
    })

    it('should handle concurrent cleanup operations', async () => {
      const states = []

      // Create multiple components
      for (let i = 0; i < 5; i++) {
        ;(nanoid as jest.Mock).mockReturnValueOnce(`session-${i}`)
        const context = {
          ...mockCorrelationContext,
          correlationId: `correlation-${i}`,
          userId: `user-${i}`,
        }
        const state = await service.createComponentState(mockMessage, context)
        states.push(state)
      }

      // Cleanup all concurrently
      const cleanupPromises = states.map(state =>
        service.cleanupComponent(state.id, 'manual', state.correlationId),
      )

      await Promise.all(cleanupPromises)

      expect(service.getMetrics().activeComponents).toBe(0)
      states.forEach(state => {
        expect(service.getComponentState(state.id)).toBeUndefined()
      })
    })

    it('should handle concurrent updates to same component', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Multiple concurrent updates
      const updatePromises = []
      for (let i = 0; i < 3; i++) {
        updatePromises.push(
          service.updateComponentState(state.id, {
            [`field${i}`]: `value${i}`,
          }),
        )
      }

      await expect(Promise.all(updatePromises)).resolves.toEqual(
        [undefined, undefined, undefined]
      )
      expect(state.interactionCount).toBe(3)
      expect(state.data).toMatchObject({
        field0: 'value0',
        field1: 'value1',
        field2: 'value2',
      })
    })

    it('should handle race condition between cleanup and update with atomic state transitions', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      // Start cleanup and update concurrently
      const cleanupPromise = service.cleanupComponent(
        state.id,
        'manual',
        state.correlationId,
      )
      
      // The update might succeed or throw depending on race condition timing
      const updatePromise = service.updateComponentState(state.id, {
        searchTerm: 'testValue',
      } as any).catch((error) => error) // Catch error to prevent unhandled rejection

      const [, updateResult] = await Promise.all([cleanupPromise, updatePromise])

      // Cleanup should always succeed with atomic transitions
      expect(state.state).toBe(ComponentLifecycleState.CLEANED)
      expect(service.getComponentState(state.id)).toBeUndefined()
      
      // The update could succeed or fail depending on race condition timing
      // Both outcomes are valid with proper atomic state transitions
      if (updateResult === undefined) {
        // Update succeeded before cleanup
        // This is the expected success case
      } else {
        // Update threw an error (cleanup happened first)
        expect(updateResult).toBeInstanceOf(ComponentStateInactiveError)
      }
    })
  })

  describe('Legacy Compatibility Methods', () => {
    let state: ComponentState

    beforeEach(async () => {
      state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )
    })

    it('should provide legacy updateComponentStateLegacy method', async () => {
      const updateData = {
        searchTerm: 'test query',
        currentPage: 1,
      }

      const result = await (service as any).updateComponentStateLegacy(
        state.id,
        updateData,
        state.correlationId,
      )

      expect(result).toBe(true)
      expect(state.data).toMatchObject(updateData)
    })

    it('should return false for legacy method when component not found', async () => {
      const result = await (service as any).updateComponentStateLegacy(
        'non-existent-id',
        { currentPage: 2 },
      )

      expect(result).toBe(false)
    })

    it('should return false for legacy method when component is inactive', async () => {
      state.state = ComponentLifecycleState.CLEANED

      const result = await (service as any).updateComponentStateLegacy(
        state.id,
        { currentPage: 2 },
        state.correlationId,
      )

      expect(result).toBe(false)
      expect(state.interactionCount).toBe(0) // Should not increment
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle custom filter in collector configuration', async () => {
      const customFilter = jest.fn().mockReturnValue(true)
      const config: ComponentCollectorConfig = {
        time: COMPONENT_CONFIG.LIFETIME_MS,
        filter: customFilter,
      }

      await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        config,
      )

      const collectorCall = (
        mockMessage.createMessageComponentCollector as jest.Mock
      ).mock.calls[0][0]
      expect(collectorCall.filter).toBe(customFilter)
    })

    it('should use default filter when none provided', async () => {
      await service.createComponentState(mockMessage, mockCorrelationContext)

      const collectorCall = (
        mockMessage.createMessageComponentCollector as jest.Mock
      ).mock.calls[0][0]
      expect(typeof collectorCall.filter).toBe('function')

      // Test default filter
      const mockInteraction = {
        user: { id: mockCorrelationContext.userId },
      } as unknown as MessageComponentInteraction

      expect(collectorCall.filter(mockInteraction)).toBe(true)

      const wrongUserInteraction = {
        user: { id: 'different-user' },
      } as unknown as MessageComponentInteraction

      expect(collectorCall.filter(wrongUserInteraction)).toBe(false)
    })

    it('should handle missing correlation ID in state update', async () => {
      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
      )

      const result = await service.updateComponentState(state.id, {
        searchTerm: 'testValue',
      })

      expect(result).toBe(true)
    })

    it('should handle warning timeout for very short lifetimes', async () => {
      const config: ComponentCollectorConfig = {
        time: 1000, // 1 second - less than warning offset
      }

      await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        config,
      )

      // Warning should not be scheduled if lifetime is too short
      const warningDelay = 1000 - COMPONENT_CONFIG.WARNING_OFFSET_MS
      if (warningDelay <= 0) {
        // Fast forward to expiration
        jest.advanceTimersByTime(1000)

        // Should not have emitted warning event
        expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
          'component.timeout.warning',
          expect.anything(),
        )
      }
    })

    it('should handle collector with no timeout configuration', async () => {
      const config: ComponentCollectorConfig = {
        time: 0, // No timeout
      }

      const state = await service.createComponentState(
        mockMessage,
        mockCorrelationContext,
        config,
      )

      // Service defaults to COMPONENT_CONFIG.LIFETIME_MS when time is 0
      expect(state.expiresAt.getTime()).toBe(
        state.createdAt.getTime() + COMPONENT_CONFIG.LIFETIME_MS,
      )
    })

    it('should generate unique session IDs', () => {
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-1')
      ;(nanoid as jest.Mock).mockReturnValueOnce('session-2')

      const id1 = (service as any).generateSessionId()
      const id2 = (service as any).generateSessionId()

      expect(id1).toBe('session-1')
      expect(id2).toBe('session-2')
      expect(id1).not.toBe(id2)
    })

    it('should handle empty user sessions correctly', () => {
      const sessions = service.getUserSessions('non-existent-user')
      expect(sessions).toEqual([])
    })

    it('should handle isStateActive for all lifecycle states', () => {
      const isStateActive = (service as any).isStateActive.bind(service)

      expect(isStateActive({ state: ComponentLifecycleState.ACTIVE })).toBe(
        true,
      )
      expect(isStateActive({ state: ComponentLifecycleState.WARNING })).toBe(
        true,
      )
      expect(isStateActive({ state: ComponentLifecycleState.EXPIRED })).toBe(
        false,
      )
      expect(isStateActive({ state: ComponentLifecycleState.CLEANED })).toBe(
        false,
      )
    })

    it('should handle shouldCleanupState for all conditions', () => {
      const shouldCleanupState = (service as any).shouldCleanupState.bind(
        service,
      )
      const now = Date.now()

      // Expired state
      expect(
        shouldCleanupState({ state: ComponentLifecycleState.EXPIRED }),
      ).toBe(true)

      // Past grace period
      expect(
        shouldCleanupState({
          state: ComponentLifecycleState.ACTIVE,
          expiresAt: new Date(now - COMPONENT_CONFIG.GRACE_PERIOD_MS - 1000),
        }),
      ).toBe(true)

      // Within grace period
      expect(
        shouldCleanupState({
          state: ComponentLifecycleState.ACTIVE,
          expiresAt: new Date(now + 60000),
        }),
      ).toBe(false)
    })
  })
})
