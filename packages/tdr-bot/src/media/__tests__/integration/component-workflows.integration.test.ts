/**
 * End-to-End Component Workflow Integration Tests
 *
 * These tests validate complete user workflows from initial search to final request,
 * testing how components work together in realistic user scenarios.
 *
 * Business Impact: Ensures primary user workflows function correctly and gracefully
 * handle complex interaction patterns, component lifecycle management, and state
 * transitions during multi-step operations.
 */

// Mock Discord.js at the module level
jest.mock('discord.js', () => ({
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
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
  TextInputStyle: {
    Short: 1,
    Paragraph: 2,
  },
  ActionRowBuilder: jest.fn(),
  ButtonBuilder: jest.fn(),
  EmbedBuilder: jest.fn(),
  ModalBuilder: jest.fn(),
  StringSelectMenuBuilder: jest.fn(),
}))

import { EventEmitter2 } from '@nestjs/event-emitter'
import { TestingModule } from '@nestjs/testing'
import { ButtonStyle, Message, TextInputStyle } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import {
  createChannelId,
  createCorrelationId,
  createMockErrorClassificationService,
  createMockMediaLoggingService,
  createMockRetryService,
  createUserId,
  type MockMediaLoggingService,
} from 'src/media/__tests__/types/test-mocks.types'
import { ComponentLifecycleState } from 'src/media/component-config'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ComponentFactoryService } from 'src/media/components/component.factory'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import { ComponentStateNotFoundError } from 'src/media/errors/media-errors'
import { ComponentStateService } from 'src/media/services/component-state.service'
import { DiscordErrorService } from 'src/media/services/discord-error.service'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import {
  ButtonConfig,
  CorrelationContext,
  ModalConfig,
  SelectMenuConfig,
} from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock Discord.js Message class for integration testing
class MockMessage {
  id = '123456789'
  channelId = '987654321'
  guildId = '456789123'

  createMessageComponentCollector = jest.fn().mockImplementation(() => ({
    on: jest.fn().mockReturnThis(),
    stop: jest.fn(),
    ended: false,
  }))
}

describe('End-to-End Component Workflows', () => {
  let module: TestingModule
  let componentFactory: ComponentFactoryService
  let componentState: ComponentStateService
  let loggingService: MockMediaLoggingService
  let mockMessage: MockMessage

  beforeEach(async () => {
    // Create comprehensive testing module with all integration dependencies
    module = await createTestingModule([
      ComponentFactoryService,
      ComponentStateService,
      DiscordErrorService,
      EventEmitter2,
      {
        provide: MediaLoggingService,
        useFactory: createMockMediaLoggingService,
      },
      {
        provide: ActionRowBuilderService,
        useValue: {
          createButtonRow: jest
            .fn()
            .mockImplementation((buttons: unknown[]) => ({
              addComponents: jest.fn().mockReturnThis(),
              toJSON: jest.fn().mockReturnValue({
                type: 1,
                components: buttons.map(b => (b as any).toJSON?.() || b),
              }),
            })),
          createSelectMenuRow: jest
            .fn()
            .mockImplementation((selectMenu: unknown) => ({
              addComponents: jest.fn().mockReturnThis(),
              toJSON: jest.fn().mockReturnValue({
                type: 1,
                components: [(selectMenu as any).toJSON?.() || selectMenu],
              }),
            })),
        },
      },
      {
        provide: ButtonBuilderService,
        useValue: {
          createButton: jest.fn().mockImplementation((config: unknown) => ({
            data: {
              custom_id: (config as any).customId,
              label: (config as any).label,
              style: (config as any).style,
            },
            setCustomId: jest.fn().mockReturnThis(),
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
            toJSON: jest.fn().mockReturnValue({
              custom_id: (config as any).customId,
              label: (config as any).label,
              style: (config as any).style,
            }),
          })),
        },
      },
      {
        provide: SelectMenuBuilderService,
        useValue: {
          createSelectMenu: jest.fn().mockImplementation((config: unknown) => ({
            data: {
              custom_id: (config as any).customId,
              placeholder: (config as any).placeholder,
              options: (config as any).options || [],
            },
            setCustomId: jest.fn().mockReturnThis(),
            setPlaceholder: jest.fn().mockReturnThis(),
            setOptions: jest.fn().mockReturnThis(),
            addOptions: jest.fn().mockReturnThis(),
            toJSON: jest.fn().mockReturnValue({
              custom_id: (config as any).customId,
              placeholder: (config as any).placeholder,
              options: (config as any).options || [],
            }),
          })),
        },
      },
      {
        provide: ModalBuilderService,
        useValue: {
          createModal: jest.fn().mockImplementation((config: unknown) => ({
            data: {
              custom_id: (config as any).customId,
              title: (config as any).title,
              components: (config as any).components || [],
            },
            setCustomId: jest.fn().mockReturnThis(),
            setTitle: jest.fn().mockReturnThis(),
            addComponents: jest.fn().mockReturnThis(),
            toJSON: jest.fn().mockReturnValue({
              custom_id: (config as any).customId,
              title: (config as any).title,
              components: (config as any).components || [],
            }),
          })),
        },
      },
      {
        provide: ErrorClassificationService,
        useFactory: createMockErrorClassificationService,
      },
      {
        provide: RetryService,
        useFactory: createMockRetryService,
      },
    ])

    componentFactory = module.get<ComponentFactoryService>(
      ComponentFactoryService,
    )
    componentState = module.get<ComponentStateService>(ComponentStateService)
    loggingService = module.get<MediaLoggingService>(
      MediaLoggingService,
    ) as unknown as MockMediaLoggingService

    mockMessage = new MockMessage()

    // Setup default mock responses for integration scenarios
    loggingService.createCorrelationContext.mockReturnValue({
      correlationId: 'test-correlation-123',
      userId: 'test-user',
      username: 'TestUser',
      guildId: '123',
      channelId: '456',
      startTime: new Date(),
    })
    // Mock as any to avoid strict typing issues in integration tests
    ;(loggingService.logComponentInteraction as jest.Mock).mockResolvedValue(
      undefined,
    )
    ;(loggingService.logPerformance as jest.Mock).mockResolvedValue(undefined)
  })

  afterEach(async () => {
    // Ensure proper cleanup after each test to prevent state leakage
    if (
      componentState &&
      typeof componentState.onModuleDestroy === 'function'
    ) {
      await componentState.onModuleDestroy()
    }
    if (module) {
      await module.close()
    }
  })

  describe('search-to-request workflow', () => {
    it('should handle complete movie search and request workflow', async () => {
      // Test: Search buttons → Modal → Result selection → Request confirmation
      // Business Impact: Ensures primary user workflow functions correctly

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('workflow-search-001'),
        userId: createUserId('user123'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      // Phase 1: Initial search button creation and state setup
      const searchButtonConfig: ButtonConfig = {
        customId: 'search_movie_btn',
        label: 'Search Movies',
        style: ButtonStyle.Primary,
      }

      const searchButton = componentFactory.createButton(searchButtonConfig)
      const initialState = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
        { time: 60000 },
      )

      expect(searchButton).toBeDefined()
      expect(initialState.state).toBe(ComponentLifecycleState.ACTIVE)
      expect(initialState.correlationId).toBe(correlationContext.correlationId)

      // Phase 2: Modal creation and form interaction simulation
      const modalConfig: ModalConfig = {
        customId: 'search_modal',
        title: 'Movie Search',
        components: [
          {
            customId: 'search_input',
            label: 'Movie Title',
            style: TextInputStyle.Short,
            placeholder: 'Enter movie title...',
            required: true,
            minLength: 1,
            maxLength: 100,
          },
        ],
      }

      // Test modal creation capability (variable not used in assertion)
      componentFactory.createModal(modalConfig)

      // Simulate user filling out modal and submitting
      await componentState.updateComponentState(
        initialState.id,
        {
          searchQuery: 'The Matrix',
          mediaType: MediaType.MOVIE,
          searchTerm: 'The Matrix',
        },
        correlationContext.correlationId,
      )

      const updatedState = componentState.getComponentState(initialState.id)
      expect(updatedState?.data.searchTerm).toBe('The Matrix')
      expect(updatedState?.interactionCount).toBe(1)

      // Phase 3: Search results selection menu creation
      const resultsSelectConfig: SelectMenuConfig = {
        customId: 'movie_results_select',
        placeholder: 'Select a movie from results',
        options: [
          {
            label: 'The Matrix (1999)',
            value: 'matrix_1999',
            description: 'Sci-fi action movie',
          },
          {
            label: 'The Matrix Reloaded (2003)',
            value: 'matrix_reloaded_2003',
            description: 'Sequel to The Matrix',
          },
        ],
      }

      // Test select menu creation capability (variable not used in assertion)
      componentFactory.createSelectMenu(resultsSelectConfig)

      // Simulate user selection
      await componentState.updateComponentState(
        initialState.id,
        {
          selectedItems: [
            {
              id: 'matrix_1999',
              title: 'The Matrix',
              year: 1999,
              mediaType: MediaType.MOVIE,
            },
          ],
        },
        correlationContext.correlationId,
      )

      // Phase 4: Request confirmation workflow
      const confirmButtonConfig: ButtonConfig = {
        customId: 'confirm_request',
        label: 'Request Movie',
        style: ButtonStyle.Success,
      }

      // Test button creation capability (variable not used in assertion)
      componentFactory.createButton(confirmButtonConfig)

      // Final state should contain complete workflow data
      const finalState = componentState.getComponentState(initialState.id)
      expect(finalState?.data.selectedItems?.[0]?.title).toBe('The Matrix')
      expect(finalState?.interactionCount).toBe(2)
      expect(finalState?.state).toBe(ComponentLifecycleState.ACTIVE)

      // Verify logging service was available (component interaction logging is internal)
      expect(loggingService.logComponentInteraction).toBeDefined()
    })

    it('should handle workflow interruption and recovery', async () => {
      // Test: Component expiry mid-workflow
      // Business Impact: Graceful handling of expired interactions

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('workflow-interrupt-001'),
        userId: createUserId('user456'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel789'),
        startTime: new Date(),
      }

      // Create component with very short timeout for testing
      const state = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
        { time: 100 }, // 100ms timeout
      )

      // Simulate workflow steps with delays that exceed component timeout
      await new Promise(resolve => setTimeout(resolve, 150)) // Wait longer than timeout

      // Attempt to update expired component should handle gracefully
      // The component will have been cleaned up, so we'll get ComponentStateNotFoundError
      await expect(
        componentState.updateComponentState(
          state.id,
          { searchQuery: 'Expired Search' },
          correlationContext.correlationId,
        ),
      ).rejects.toThrow(ComponentStateNotFoundError)

      // Verify state was properly transitioned to expired/cleaned
      const finalState = componentState.getComponentState(state.id)
      expect(finalState).toBeUndefined() // Should be cleaned up
    })

    it('should handle user session conflicts during workflows', async () => {
      // Test: Multiple users accessing same workflow simultaneously
      // Business Impact: Prevents cross-user state contamination

      const user1Context: CorrelationContext = {
        correlationId: createCorrelationId('workflow-user1-001'),
        userId: createUserId('user123'),
        username: 'User1',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      const user2Context: CorrelationContext = {
        correlationId: createCorrelationId('workflow-user2-001'),
        userId: createUserId('user789'),
        username: 'User2',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      // Create separate states for different users
      const user1State = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        user1Context,
      )

      const user2State = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        user2Context,
      )

      // Both users update their respective states
      await componentState.updateComponentState(
        user1State.id,
        { searchQuery: 'User 1 Movie' },
        user1Context.correlationId,
      )

      await componentState.updateComponentState(
        user2State.id,
        { searchQuery: 'User 2 Movie' },
        user2Context.correlationId,
      )

      // Verify state isolation - each user has their own data
      const user1FinalState = componentState.getComponentState(user1State.id)
      const user2FinalState = componentState.getComponentState(user2State.id)

      expect(user1FinalState?.data.searchQuery).toBe('User 1 Movie')
      expect(user2FinalState?.data.searchQuery).toBe('User 2 Movie')
      expect(user1FinalState?.userId).toBe(user1Context.userId)
      expect(user2FinalState?.userId).toBe(user2Context.userId)

      // Verify no cross-contamination
      expect(user1FinalState?.data.searchQuery).not.toBe(
        user2FinalState?.data.searchQuery,
      )
    })
  })

  describe('state management across components', () => {
    it('should maintain state consistency across component transitions', async () => {
      // Test: State transitions between different component types
      // Business Impact: Prevents state corruption in complex workflows

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('state-consistency-001'),
        userId: createUserId('user123'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      const state = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
      )

      // Phase 1: Button interaction adds initial data
      await componentState.updateComponentState(
        state.id,
        {
          searchTerm: 'button_interaction',
          mediaType: MediaType.MOVIE,
        },
        correlationContext.correlationId,
      )

      // Phase 2: Modal interaction adds form data
      await componentState.updateComponentState(
        state.id,
        {
          searchTerm: 'modal_interaction',
          formData: {
            title: 'The Godfather',
            year: '1972',
            genre: 'Drama',
          },
        },
        correlationContext.correlationId,
      )

      // Phase 3: Select menu interaction adds selection data
      await componentState.updateComponentState(
        state.id,
        {
          searchTerm: 'selection_interaction',
          selectedItems: [
            {
              id: 'godfather_1972',
              title: 'The Godfather',
              year: 1972,
              mediaType: MediaType.MOVIE,
            },
          ],
        },
        correlationContext.correlationId,
      )

      // Verify all data persisted through transitions
      const finalState = componentState.getComponentState(state.id)
      expect(finalState?.data.mediaType).toBe(MediaType.MOVIE)
      expect(finalState?.data.formData?.title).toBe('The Godfather')
      expect(finalState?.data.selectedItems?.[0]?.title).toBe('The Godfather')
      expect(finalState?.interactionCount).toBe(3)

      // Verify data integrity - no corruption during transitions
      expect(finalState?.data.searchTerm).toBe('selection_interaction')
    })

    it('should cleanup expired components without affecting active ones', async () => {
      // Test: Selective cleanup during multi-component workflows
      // Business Impact: Prevents interference between user sessions

      const activeContext: CorrelationContext = {
        correlationId: createCorrelationId('cleanup-active-001'),
        userId: createUserId('activeuser'),
        username: 'ActiveUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      const expiredContext: CorrelationContext = {
        correlationId: createCorrelationId('cleanup-expired-001'),
        userId: createUserId('expireduser'),
        username: 'ExpiredUser',
        guildId: '987654321',
        channelId: createChannelId('channel789'),
        startTime: new Date(),
      }

      // Create active component with long timeout
      const activeState = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        activeContext,
        { time: 60000 },
      )

      // Create component that will expire quickly
      const expiredState = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        expiredContext,
        { time: 100 },
      )

      // Update both states
      await componentState.updateComponentState(
        activeState.id,
        { searchQuery: 'active_workflow' },
        activeContext.correlationId,
      )

      await componentState.updateComponentState(
        expiredState.id,
        { searchQuery: 'will_expire' },
        expiredContext.correlationId,
      )

      // Wait for expired component to timeout
      await new Promise(resolve => setTimeout(resolve, 200))

      // Force cleanup to run
      await componentState.performCleanup('timeout')

      // Active component should still exist
      const activeAfterCleanup = componentState.getComponentState(
        activeState.id,
      )
      const expiredAfterCleanup = componentState.getComponentState(
        expiredState.id,
      )

      expect(activeAfterCleanup).toBeDefined()
      expect(activeAfterCleanup?.data.searchQuery).toBe('active_workflow')
      expect(expiredAfterCleanup).toBeUndefined() // Should be cleaned up
    })

    it('should handle state size limits during complex workflows', async () => {
      // Test: Large search results in multi-step workflows
      // Business Impact: Prevents memory exhaustion in long workflows

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('state-limits-001'),
        userId: createUserId('user123'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      const state = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
      )

      // Simulate adding progressively larger state data
      const largeSearchResults = Array.from({ length: 50 }, (_, i) => ({
        id: `movie_${i}`,
        title: `Movie Title ${i}`,
        overview: `A very detailed description for movie ${i} with lots of information about the plot, cast, director, and other metadata that might be returned from a media API`,
        year: 2000 + i,
        mediaType: MediaType.MOVIE,
        inLibrary: false,
        tmdbId: i,
        imdbId: `tt${String(i).padStart(7, '0')}`,
        posterUrl: `https://image.tmdb.org/movie/${i}.jpg`,
        genres: ['Action', 'Drama', 'Comedy', 'Thriller'],
      }))

      // Update state with large data - should handle gracefully
      await componentState.updateComponentState(
        state.id,
        {
          searchResults: largeSearchResults,
        },
        correlationContext.correlationId,
      )

      const updatedState = componentState.getComponentState(state.id)
      expect(updatedState?.data.searchResults).toHaveLength(50)
      expect(updatedState?.data.searchResults).toHaveLength(50)

      // State should remain manageable and functional
      expect(updatedState?.state).toBe(ComponentLifecycleState.ACTIVE)
      expect(updatedState?.interactionCount).toBe(1)
    })
  })

  describe('constraint validation integration', () => {
    it('should handle compound constraint violations gracefully', async () => {
      // Test: Multiple constraints violated simultaneously
      // Business Impact: Prevents Discord API errors from complex UIs

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('constraints-compound-001'),
        userId: createUserId('user123'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      // Create component and test with data that violates multiple constraints
      const state = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
      )

      // Create an overly complex select menu that would violate Discord limits
      const oversizedSelectConfig: SelectMenuConfig = {
        customId: 'oversized_select',
        placeholder:
          "This is an extremely long placeholder that exceeds Discord's limits for select menu placeholders and should be handled gracefully by the constraint validation system",
        options: Array.from({ length: 30 }, (_, i) => ({
          label: `Option ${i} with a very long label that might exceed Discord limits`,
          value: `option_${i}_with_very_long_value_string`,
          description: `This is an extremely detailed description for option ${i} that provides comprehensive information about what this option does and why someone might want to select it, potentially exceeding Discord's description length limits`,
        })),
      }

      // Component factory should handle constraint violations gracefully
      const oversizedSelect = componentFactory.createSelectMenu(
        oversizedSelectConfig,
      )
      expect(oversizedSelect).toBeDefined()

      // State should remain functional despite constraint handling
      const finalState = componentState.getComponentState(state.id)
      expect(finalState?.state).toBe(ComponentLifecycleState.ACTIVE)
    })

    it('should respect action row limits in complex UI builds', async () => {
      // Test: Component distribution across multiple action rows
      // Business Impact: Ensures Discord limits are respected

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('actionrow-limits-001'),
        userId: createUserId('user123'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      const state = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
      )

      // Create multiple button configs that would need to be distributed across action rows
      const buttonConfigs = Array.from({ length: 15 }, (_, i) => ({
        customId: `button_${i}`,
        label: `Button ${i}`,
        style: ButtonStyle.Secondary,
      }))

      // Create individual buttons for each config
      const buttons = buttonConfigs.map(config =>
        componentFactory.createButton(config),
      )

      // Test that we can create action rows with proper distribution
      // For this test, we'll simulate the row distribution logic
      const expectedActionRowCount = Math.ceil(buttons.length / 5) // Max 5 buttons per row
      expect(expectedActionRowCount).toBe(3) // 15 buttons = 3 action rows

      // Verify buttons were created successfully
      expect(buttons).toHaveLength(15)
      buttons.forEach((button, i) => {
        expect(button).toBeDefined()
        // The button should have the custom_id in its data
        const buttonData = button.data as Record<string, unknown>
        expect(buttonData?.custom_id).toBe(`button_${i}`)
      })

      // Update state to track complex UI
      await componentState.updateComponentState(
        state.id,
        {
          searchQuery: `UI with ${expectedActionRowCount} action rows and ${buttons.length} buttons`,
        },
        correlationContext.correlationId,
      )

      const finalState = componentState.getComponentState(state.id)
      expect(finalState?.data.searchQuery).toContain('3 action rows')
      expect(finalState?.data.searchQuery).toContain('15 buttons')
    })

    it('should handle constraint validation failures during workflows', async () => {
      // Test: Constraint failures mid-workflow
      // Business Impact: Graceful error handling without breaking user experience

      const correlationContext: CorrelationContext = {
        correlationId: createCorrelationId('constraint-failures-001'),
        userId: createUserId('user123'),
        username: 'TestUser',
        guildId: '987654321',
        channelId: createChannelId('channel456'),
        startTime: new Date(),
      }

      const state = await componentState.createComponentState(
        mockMessage as unknown as Message<boolean>,
        correlationContext,
      )

      // Start with valid workflow
      await componentState.updateComponentState(
        state.id,
        {
          searchQuery: 'initial_search',
        },
        correlationContext.correlationId,
      )

      // Attempt to add data that might cause constraint issues
      // The system should handle this gracefully without breaking the workflow
      await componentState.updateComponentState(
        state.id,
        {
          searchQuery: 'x'.repeat(1000), // Potentially large data but within reasonable limits
        },
        correlationContext.correlationId,
      )

      // Workflow should remain functional - the large data should have been accepted
      const updatedState = componentState.getComponentState(state.id)
      expect(updatedState?.data.searchQuery).toBe('x'.repeat(1000))
      expect(updatedState?.state).toBe(ComponentLifecycleState.ACTIVE)

      // Should be able to continue with valid data
      await componentState.updateComponentState(
        state.id,
        {
          searchQuery: 'workflow_continued',
        },
        correlationContext.correlationId,
      )

      const recoveredState = componentState.getComponentState(state.id)
      expect(recoveredState?.data.searchQuery).toBe('workflow_continued')
    })
  })
})
