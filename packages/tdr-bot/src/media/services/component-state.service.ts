import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Mutex } from 'async-mutex'
import { ComponentType, InteractionCollector, Message } from 'discord.js'
import { nanoid } from 'nanoid'

import {
  CleanupReason,
  COMPONENT_CONFIG,
  ComponentLifecycleState,
} from 'src/media/component-config'
import { ErrorContext, MediaErrorHandler } from 'src/media/errors/error-utils'
import {
  CleanupError,
  ComponentLimitExceededError,
  ComponentStateError,
  ComponentStateInactiveError,
  ComponentStateNotFoundError,
  ComponentTransitionError,
} from 'src/media/errors/media-errors'
import {
  CollectorManager,
  ComponentCleanupResult,
  ComponentCollectorConfig,
  ComponentMetrics,
  ComponentSession,
  ComponentState,
  ComponentStateData,
  CorrelationContext,
  extractStringFromMetadata,
  MessageComponentInteraction,
} from 'src/types/discord.types'
import { EventType } from 'src/types/enums'

@Injectable()
export class ComponentStateService implements OnModuleDestroy {
  private readonly logger = new Logger(ComponentStateService.name)
  private readonly errorHandler: MediaErrorHandler

  private readonly collectorManager: CollectorManager = {
    collectors: new Map(),
    activeStates: new Map(),
    timeouts: new Map(),
  }

  // Mutex-based atomic state transition system
  private readonly stateMutexes = new Map<string, Mutex>()
  private readonly globalMutex = new Mutex()

  private cleanupInterval?: NodeJS.Timeout
  private metrics: ComponentMetrics = {
    totalComponents: 0,
    activeComponents: 0,
    expiredComponents: 0,
    totalInteractions: 0,
    avgResponseTime: 0,
    errorRate: 0,
  }

  constructor(private readonly eventEmitter: EventEmitter2) {
    this.errorHandler = new MediaErrorHandler(this.logger, this.eventEmitter)
    this.startCleanupInterval()
  }

  /**
   * Get or create a mutex for a specific state ID
   */
  private getStateMutex(stateId: string): Mutex {
    let mutex = this.stateMutexes.get(stateId)
    if (!mutex) {
      mutex = new Mutex()
      this.stateMutexes.set(stateId, mutex)
    }
    return mutex
  }

  /**
   * Atomically transition component state with proper locking
   * @throws {ComponentStateNotFoundError} When state doesn't exist
   * @throws {ComponentTransitionError} When transition is invalid
   */
  private async atomicStateTransition(
    stateId: string,
    targetState: ComponentLifecycleState,
    reason?: string,
    correlationId?: string,
  ): Promise<{
    previousState: ComponentLifecycleState
    state: ComponentState
  }> {
    const mutex = this.getStateMutex(stateId)

    return await mutex.runExclusive(async () => {
      const state = this.collectorManager.activeStates.get(stateId)
      if (!state) {
        throw new ComponentStateNotFoundError(stateId, correlationId)
      }

      const previousState = state.state

      // Check if already in target state
      if (previousState === targetState) {
        return { previousState, state }
      }

      // Validate state transition is allowed
      if (!this.isValidStateTransition(previousState, targetState)) {
        throw new ComponentTransitionError(
          stateId,
          previousState,
          targetState,
          correlationId,
        )
      }

      // Perform atomic state update
      state.state = targetState

      this.logger.debug('Atomic state transition completed', {
        stateId,
        previousState,
        newState: targetState,
        reason,
        correlationId,
      })

      return { previousState, state }
    })
  }

  /**
   * Validate if a state transition is allowed
   */
  private isValidStateTransition(
    from: ComponentLifecycleState,
    to: ComponentLifecycleState,
  ): boolean {
    // Define allowed state transitions
    const transitions: Record<
      ComponentLifecycleState,
      ComponentLifecycleState[]
    > = {
      [ComponentLifecycleState.ACTIVE]: [
        ComponentLifecycleState.WARNING,
        ComponentLifecycleState.EXPIRED,
        ComponentLifecycleState.CLEANED,
      ],
      [ComponentLifecycleState.WARNING]: [
        ComponentLifecycleState.EXPIRED,
        ComponentLifecycleState.CLEANED,
      ],
      [ComponentLifecycleState.EXPIRED]: [ComponentLifecycleState.CLEANED],
      [ComponentLifecycleState.CLEANED]: [], // Terminal state
    }

    return transitions[from]?.includes(to) ?? false
  }

  /**
   * Clean up mutex when state is removed
   */
  private cleanupStateMutex(stateId: string): void {
    this.stateMutexes.delete(stateId)
  }

  async onModuleDestroy(): Promise<void> {
    await this.performCleanup('system_shutdown')
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    // Clear all remaining timeouts
    for (const timeout of this.collectorManager.timeouts.values()) {
      clearTimeout(timeout)
    }
    this.collectorManager.timeouts.clear()

    // Clear all mutex references
    this.stateMutexes.clear()
  }

  /**
   * Create a new component state and collector
   */
  async createComponentState(
    message: Message,
    correlationContext: CorrelationContext,
    config: ComponentCollectorConfig = {
      time: COMPONENT_CONFIG.LIFETIME_MS,
    },
  ): Promise<ComponentState> {
    const sessionId = this.generateSessionId()
    const stateId = `${correlationContext.correlationId}:${sessionId}`

    // Check limits and enforce them atomically
    await this.enforceComponentLimits(
      correlationContext.userId,
      correlationContext.correlationId,
    )

    const timeout = config.time || COMPONENT_CONFIG.LIFETIME_MS
    const expiresAt = new Date(Date.now() + timeout)

    const state: ComponentState = {
      id: stateId,
      userId: correlationContext.userId,
      type: ComponentType.ActionRow,
      correlationId: correlationContext.correlationId,
      sessionId,
      expiresAt,
      createdAt: new Date(),
      lastInteractionAt: new Date(),
      interactionCount: 0,
      maxInteractions: config.max || 50,
      state: ComponentLifecycleState.ACTIVE,
      data: {},
    }

    // Create collector and store atomically
    const collector = this.createCollector(message, state, {
      ...config,
      time: timeout,
    })
    this.collectorManager.activeStates.set(stateId, state)
    this.collectorManager.collectors.set(stateId, collector)

    // Schedule lifecycle timeouts
    this.scheduleLifecycleTimeouts(state)

    // Update metrics and emit event
    this.updateMetricsOnCreate()
    this.emitCreationEvent(state, correlationContext)

    this.logger.debug('Created component state', {
      stateId,
      correlationId: correlationContext.correlationId,
      userId: correlationContext.userId,
      expiresAt,
      timeout,
    })

    return state
  }

  /**
   * Get component state by ID
   */
  getComponentState(stateId: string): ComponentState | undefined {
    return this.collectorManager.activeStates.get(stateId)
  }

  /**
   * Update component state data
   * @throws {ComponentStateNotFoundError} When state ID doesn't exist
   * @throws {ComponentStateInactiveError} When state is not active
   */
  async updateComponentState(
    stateId: string,
    data: Partial<ComponentStateData>,
    correlationId?: string,
  ): Promise<void> {
    const context: ErrorContext = {
      correlationId,
      stateId,
      operation: 'update_component_state',
    }

    const state = this.collectorManager.activeStates.get(stateId)
    if (!state) {
      throw new ComponentStateNotFoundError(stateId, correlationId)
    }

    if (!this.isStateActive(state)) {
      throw new ComponentStateInactiveError(stateId, state.state, correlationId)
    }

    try {
      // Atomic state update
      state.data = { ...state.data, ...data }
      state.lastInteractionAt = new Date()
      state.interactionCount++

      this.logger.debug('Updated component state', {
        stateId,
        correlationId,
        interactionCount: state.interactionCount,
        dataKeys: Object.keys(data),
      })
    } catch (error) {
      const result = this.errorHandler.handleError(error, context)
      throw result.error
    }
  }

  /**
   * Legacy method for backward compatibility - returns boolean instead of throwing
   * @deprecated Use updateComponentState() which throws errors consistently
   */
  async updateComponentStateLegacy(
    stateId: string,
    data: Partial<ComponentStateData>,
    correlationId?: string,
  ): Promise<boolean> {
    try {
      await this.updateComponentState(stateId, data, correlationId)
      return true
    } catch (error) {
      // Log the error but return false for backward compatibility
      this.logger.warn('Component state update failed (legacy mode)', {
        stateId,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Centralized cleanup orchestrator - all cleanup paths lead here
   * @throws {CleanupError} When cleanup operations fail
   */
  async cleanupComponent(
    stateId: string,
    reason: CleanupReason,
    correlationId?: string,
  ): Promise<void> {
    const context: ErrorContext = {
      correlationId,
      stateId,
      operation: 'cleanup_component',
    }

    try {
      // Attempt atomic state transition to CLEANED
      const transitionResult = await this.atomicStateTransition(
        stateId,
        ComponentLifecycleState.CLEANED,
        reason,
        correlationId,
      )

      const { previousState, state } = transitionResult

      // Stop collector if it exists (resilient to collector errors)
      const collector = this.collectorManager.collectors.get(stateId)
      if (collector && !collector.ended) {
        try {
          collector.stop(reason)
        } catch (collectorError) {
          // Log collector cleanup failure but don't let it stop the overall cleanup
          this.logger.warn(
            'Collector cleanup failed, continuing with state cleanup',
            {
              stateId,
              correlationId,
              error:
                collectorError instanceof Error
                  ? collectorError.message
                  : String(collectorError),
            },
          )

          // Emit error event for collector cleanup failure (but continue with overall cleanup)
          this.eventEmitter.emit(EventType.COMPONENT_ERROR, {
            stateId,
            correlationId,
            error:
              collectorError instanceof Error
                ? collectorError
                : new Error(String(collectorError)),
            phase: 'collector_cleanup',
            recoverable: true,
          })
        }
      }

      // Execute custom cleanup logic
      if (state.cleanup) {
        try {
          await state.cleanup()
        } catch (customCleanupError) {
          // Log but don't fail the entire cleanup for custom cleanup errors
          this.logger.warn('Custom cleanup function failed', {
            stateId,
            correlationId,
            error:
              customCleanupError instanceof Error
                ? customCleanupError.message
                : String(customCleanupError),
          })
        }
      }

      // Remove all references atomically
      this.collectorManager.activeStates.delete(stateId)
      this.collectorManager.collectors.delete(stateId)

      // Clear associated timeout
      const timeout = this.collectorManager.timeouts.get(stateId)
      if (timeout) {
        clearTimeout(timeout)
        this.collectorManager.timeouts.delete(stateId)
      }

      // Clean up the state-specific mutex
      this.cleanupStateMutex(stateId)

      // Update metrics and emit cleanup event
      this.updateMetricsOnCleanup()
      this.emitCleanupEvent(state, reason, previousState)

      this.logger.debug('Component cleaned up', {
        stateId,
        correlationId,
        reason,
        previousState,
        duration: Date.now() - state.createdAt.getTime(),
        interactionCount: state.interactionCount,
      })
    } catch (error) {
      // If it's already a MediaError, just re-throw
      if (
        error instanceof ComponentStateError ||
        error instanceof ComponentTransitionError
      ) {
        // State not found or invalid transition - these are acceptable for cleanup
        if (error instanceof ComponentStateNotFoundError) {
          // Component already cleaned up, this is not an error
          this.logger.debug('Component already cleaned up', {
            stateId,
            correlationId,
          })
          return
        }

        // For transition errors during cleanup, log and return (don't throw)
        this.logger.debug('Component transition during cleanup', {
          stateId,
          correlationId,
          error: error.message,
        })
        return
      }

      // Handle unexpected errors
      const result = this.errorHandler.handleError(error, context)
      throw new CleanupError(
        'component',
        stateId,
        result.error.message,
        correlationId,
        context,
        result.originalError,
      )
    }
  }

  /**
   * Get user's active component sessions
   */
  getUserSessions(userId: string): ComponentSession[] {
    const sessions: ComponentSession[] = []

    for (const [stateId, state] of this.collectorManager.activeStates) {
      if (state.userId === userId && this.isStateActive(state)) {
        sessions.push({
          sessionId: state.sessionId,
          userId: state.userId,
          guildId: '',
          channelId: '',
          startTime: state.createdAt,
          lastActivity: state.lastInteractionAt,
          componentCount: 1,
          maxComponents: state.maxInteractions,
          isActive: state.state === ComponentLifecycleState.ACTIVE,
          correlationId: state.correlationId,
          metadata: {
            stateId,
            type: state.type,
            interactionCount: state.interactionCount,
            lifecycleState: state.state,
          },
        })
      }
    }

    return sessions
  }

  /**
   * Get current metrics
   */
  getMetrics(): ComponentMetrics {
    return { ...this.metrics }
  }

  /**
   * Perform cleanup of expired/stale components
   */
  async performCleanup(
    reason: CleanupReason = 'timeout',
  ): Promise<ComponentCleanupResult> {
    const startTime = Date.now()
    let cleanedComponents = 0
    const errors: string[] = []

    // Find components that need cleanup
    const statesNeedingCleanup = Array.from(
      this.collectorManager.activeStates.entries(),
    ).filter(([, state]) => this.shouldCleanupState(state))

    // Clean them up using centralized orchestrator
    for (const [stateId, state] of statesNeedingCleanup) {
      try {
        await this.cleanupComponent(stateId, reason, state.correlationId)
        cleanedComponents++
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        errors.push(`Failed to clean state ${stateId}: ${errorMessage}`)
        this.logger.error('Failed to clean component state', {
          stateId,
          correlationId: state.correlationId,
          error: errorMessage,
        })
      }
    }

    const result: ComponentCleanupResult = {
      cleanedComponents,
      cleanedStates: cleanedComponents,
      errors,
      duration: Date.now() - startTime,
      reason,
    }

    if (cleanedComponents > 0) {
      this.logger.log('Completed component cleanup', {
        cleanedComponents,
        duration: result.duration,
        reason,
        errorCount: errors.length,
      })

      this.eventEmitter.emit(EventType.COMPONENT_CLEANUP, result)
    }

    return result
  }

  /**
   * Create interaction collector for component
   */
  private createCollector(
    message: Message,
    state: ComponentState,
    config: ComponentCollectorConfig,
  ): InteractionCollector<MessageComponentInteraction> {
    const filter =
      config.filter ||
      ((interaction: MessageComponentInteraction) => {
        // Default filter - check if interaction is for this component state
        return interaction.user.id === state.userId
      })

    const collector = message.createMessageComponentCollector({
      filter: filter as never, // Type assertion needed due to Discord.js type complexity
      time: config.time,
      max: config.max,
      maxComponents: config.maxComponents,
      maxUsers: config.maxUsers,
      idle: config.idle,
    }) as InteractionCollector<MessageComponentInteraction>

    // Handle interactions
    collector.on(
      'collect',
      async (interaction: MessageComponentInteraction) => {
        // Only process if component is still active
        if (!this.isStateActive(state)) {
          return
        }

        // Immediately acknowledge the interaction to prevent timeout
        // Discord requires acknowledgment within 3 seconds
        try {
          if (!interaction.deferred && !interaction.replied) {
            this.logger.debug('Attempting to acknowledge interaction', {
              stateId: state.id,
              correlationId: state.correlationId,
              userId: interaction.user.id,
              customId: interaction.customId,
              deferred: interaction.deferred,
              replied: interaction.replied,
            })

            await interaction.deferUpdate()

            this.logger.debug('Interaction acknowledged successfully', {
              stateId: state.id,
              correlationId: state.correlationId,
              userId: interaction.user.id,
              customId: interaction.customId,
            })
          } else {
            this.logger.warn('Interaction already acknowledged, skipping', {
              stateId: state.id,
              correlationId: state.correlationId,
              userId: interaction.user.id,
              customId: interaction.customId,
              deferred: interaction.deferred,
              replied: interaction.replied,
            })

            // If interaction is already acknowledged but processing failed,
            // we should NOT continue processing as it will fail
            if (interaction.replied) {
              this.logger.error(
                'Interaction already replied, cannot continue processing',
                {
                  stateId: state.id,
                  correlationId: state.correlationId,
                  userId: interaction.user.id,
                  customId: interaction.customId,
                },
              )
              return // Stop processing this interaction
            }
          }
        } catch (error) {
          this.logger.error('CRITICAL: Failed to acknowledge interaction', {
            stateId: state.id,
            correlationId: state.correlationId,
            userId: interaction.user.id,
            customId: interaction.customId,
            error: error instanceof Error ? error.message : String(error),
            deferred: interaction.deferred,
            replied: interaction.replied,
          })

          // If acknowledgment fails, we MUST stop processing
          // Continuing will cause "interaction failed" errors
          return
        }

        // Update interaction tracking
        state.lastInteractionAt = new Date()
        state.interactionCount++
        this.metrics.totalInteractions++

        this.logger.debug('Component interaction collected', {
          stateId: state.id,
          correlationId: state.correlationId,
          userId: interaction.user.id,
          customId: interaction.customId,
          componentType: interaction.componentType,
          interactionCount: state.interactionCount,
        })

        // Emit user interaction event
        this.eventEmitter.emit(EventType.USER_INTERACTION, {
          stateId: state.id,
          correlationId: state.correlationId,
          userId: interaction.user.id,
          componentType: interaction.componentType,
          customId: interaction.customId,
          timestamp: new Date(),
          interaction, // Include the full interaction object
        })
      },
    )

    // Handle collector end - single path to cleanup orchestrator
    collector.on('end', async (collected, reason) => {
      this.logger.debug('Component collector ended', {
        stateId: state.id,
        correlationId: state.correlationId,
        reason,
        collectedCount: collected.size,
        duration: Date.now() - state.createdAt.getTime(),
      })

      // Route to centralized cleanup orchestrator
      const cleanupReason: CleanupReason =
        reason === 'time' ? 'timeout' : 'collector_end'
      if (state.state !== ComponentLifecycleState.CLEANED) {
        await this.cleanupComponent(
          state.id,
          cleanupReason,
          state.correlationId,
        )
      }
    })

    return collector
  }

  /**
   * Check if state is active (not expired/cleaned)
   */
  private isStateActive(state: ComponentState): boolean {
    return (
      state.state === ComponentLifecycleState.ACTIVE ||
      state.state === ComponentLifecycleState.WARNING
    )
  }

  /**
   * Check if state should be cleaned up
   */
  private shouldCleanupState(state: ComponentState): boolean {
    return (
      state.state === ComponentLifecycleState.EXPIRED ||
      Date.now() > state.expiresAt.getTime() + COMPONENT_CONFIG.GRACE_PERIOD_MS
    )
  }

  /**
   * Enforce component limits (user and global)
   * @throws {ComponentLimitExceededError} When limits are exceeded and cleanup fails
   */
  private async enforceComponentLimits(
    userId: string,
    correlationId?: string,
  ): Promise<void> {
    const context: ErrorContext = {
      correlationId,
      userId,
      operation: 'enforce_limits',
    }

    // Check global limit
    const currentGlobalCount = this.collectorManager.activeStates.size
    if (currentGlobalCount >= COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL) {
      throw new ComponentLimitExceededError(
        'global',
        currentGlobalCount,
        COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL,
        correlationId,
        userId,
      )
    }

    // Check and enforce user limits
    const userSessions = this.getUserSessions(userId)
    if (userSessions.length >= COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER) {
      try {
        // Clean up oldest session for this user
        const oldestSession = userSessions.sort(
          (a, b) => a.lastActivity.getTime() - b.lastActivity.getTime(),
        )[0]

        if (oldestSession) {
          const stateId = extractStringFromMetadata(
            oldestSession.metadata,
            'stateId',
          )
          if (!stateId) {
            throw new ComponentStateError(
              'Unable to clean up oldest session: missing stateId',
              correlationId,
              undefined,
              {
                sessionId: oldestSession.sessionId,
                userSessionCount: userSessions.length,
              },
            )
          }

          await this.cleanupComponent(
            stateId,
            'user_limit',
            oldestSession.correlationId,
          )

          this.logger.warn(
            'Cleaned up oldest component to make room for new one',
            {
              userId,
              cleanedStateId: stateId,
              userSessionCount: userSessions.length,
            },
          )
        }
      } catch (error) {
        // If cleanup fails, throw limit exceeded error
        this.errorHandler.handleError(error, context)

        throw new ComponentLimitExceededError(
          'user',
          userSessions.length,
          COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER,
          correlationId,
          userId,
        )
      }
    }
  }

  /**
   * Schedule lifecycle timeouts (warning and expiration)
   */
  private scheduleLifecycleTimeouts(state: ComponentState): void {
    const warningTime =
      state.expiresAt.getTime() - COMPONENT_CONFIG.WARNING_OFFSET_MS
    const warningDelay = warningTime - Date.now()

    const expirationDelay = state.expiresAt.getTime() - Date.now()

    // Schedule warning if there's time
    if (warningDelay > 0) {
      const warningTimeout = setTimeout(async () => {
        try {
          // Use atomic state transition for warning
          await this.atomicStateTransition(
            state.id,
            ComponentLifecycleState.WARNING,
            'timeout_warning',
            state.correlationId,
          )

          this.logger.debug('Component entering warning state', {
            stateId: state.id,
            correlationId: state.correlationId,
            timeRemaining: COMPONENT_CONFIG.WARNING_OFFSET_MS,
          })

          this.eventEmitter.emit('component.timeout.warning', {
            stateId: state.id,
            correlationId: state.correlationId,
            timeRemaining: COMPONENT_CONFIG.WARNING_OFFSET_MS,
          })
        } catch (error) {
          // Transition failed - component may have been cleaned up already
          this.logger.debug('Warning transition failed', {
            stateId: state.id,
            correlationId: state.correlationId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }, warningDelay)

      this.collectorManager.timeouts.set(`${state.id}:warning`, warningTimeout)
    }

    // Schedule expiration
    const expirationTimeout = setTimeout(async () => {
      try {
        // Use atomic state transition for expiration
        await this.atomicStateTransition(
          state.id,
          ComponentLifecycleState.EXPIRED,
          'timeout_expiration',
          state.correlationId,
        )

        // Proceed with cleanup after successful transition to EXPIRED
        await this.cleanupComponent(state.id, 'timeout', state.correlationId)
      } catch (error) {
        // Transition or cleanup failed - component may have been cleaned up already
        this.logger.debug('Expiration transition/cleanup failed', {
          stateId: state.id,
          correlationId: state.correlationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, expirationDelay)

    this.collectorManager.timeouts.set(
      `${state.id}:expiration`,
      expirationTimeout,
    )
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return nanoid(8)
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      await this.performCleanup('timeout')
    }, COMPONENT_CONFIG.CLEANUP_INTERVAL_MS)
  }

  /**
   * Update metrics on component creation
   */
  private updateMetricsOnCreate(): void {
    this.metrics.totalComponents++
    this.metrics.activeComponents = this.collectorManager.activeStates.size
  }

  /**
   * Update metrics on component cleanup
   */
  private updateMetricsOnCleanup(): void {
    this.metrics.activeComponents = this.collectorManager.activeStates.size
    this.metrics.expiredComponents++

    // Calculate error rate
    if (this.metrics.totalComponents > 0) {
      this.metrics.errorRate =
        (this.metrics.expiredComponents / this.metrics.totalComponents) * 100
    }
  }

  /**
   * Emit component creation event
   */
  private emitCreationEvent(
    state: ComponentState,
    correlationContext: CorrelationContext,
  ): void {
    this.eventEmitter.emit(EventType.COMPONENT_CREATED, {
      stateId: state.id,
      correlationId: correlationContext.correlationId,
      userId: correlationContext.userId,
      expiresAt: state.expiresAt,
      lifecycleState: state.state,
    })
  }

  /**
   * Emit component cleanup event
   */
  private emitCleanupEvent(
    state: ComponentState,
    reason: CleanupReason,
    previousState: ComponentLifecycleState,
  ): void {
    // Emit appropriate event based on cleanup reason
    const eventType =
      reason === 'timeout'
        ? EventType.COMPONENT_EXPIRED
        : EventType.COMPONENT_CLEANED

    this.eventEmitter.emit(eventType, {
      stateId: state.id,
      correlationId: state.correlationId,
      reason,
      previousState,
      duration: Date.now() - state.createdAt.getTime(),
      interactionCount: state.interactionCount,
    })
  }
}
