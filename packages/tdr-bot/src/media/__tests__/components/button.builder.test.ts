import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import { ButtonBuilder, ButtonStyle } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ButtonConfig } from 'src/types/discord.types'
import { ActionType, MediaType } from 'src/types/enums'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
    data: {} as any,
  })),
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
}))

describe('ButtonBuilderService', () => {
  let service: ButtonBuilderService
  let loggerSpy: jest.SpyInstance
  let mockButtonBuilder: jest.MockedClass<typeof ButtonBuilder>

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ButtonBuilderService,
    ])

    service = module.get<ButtonBuilderService>(ButtonBuilderService)
    mockButtonBuilder = ButtonBuilder as jest.MockedClass<typeof ButtonBuilder>

    // Mock logger to avoid console output during tests
    loggerSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => {})
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})

    // Mock environment variables
    process.env.EMBY_BASE_URL = 'https://emby.example.com'
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('createSearchButton', () => {
    it('should create search button for movies', () => {
      const button = service.createSearchButton(
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(button).toBeDefined()
      expect(mockButtonBuilder).toHaveBeenCalled()

      // Verify the method calls were made correctly
      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'search_action:test-correlation:movie',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Search Movies')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Primary)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('🔍')
    })

    it('should create search button for series', () => {
      const button = service.createSearchButton(
        MediaType.SERIES,
        'test-correlation',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'search_action:test-correlation:series',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Search Series')
    })

    it('should handle missing correlation ID', () => {
      const button = service.createSearchButton(MediaType.MOVIE)

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'search_action:unknown:movie',
      )
    })

    it('should truncate long custom IDs', () => {
      const longCorrelationId = 'a'.repeat(100)
      const button = service.createSearchButton(
        MediaType.MOVIE,
        longCorrelationId,
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      const customIdCall = buttonInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toHaveLength(100)
      expect(customIdCall).toContain('search_action:')
      expect(customIdCall).toMatch(/search_action:/)
    })
  })

  describe('createRequestButton', () => {
    it('should create request button', () => {
      const button = service.createRequestButton(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
        'test-correlation',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'request_action:test-correlation:movie:media123',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Request')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Success)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('➕')
    })

    it('should handle missing correlation ID', () => {
      const button = service.createRequestButton(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'request_action:unknown:movie:media123',
      )
    })
  })

  describe('createAddToLibraryButton', () => {
    it('should create add to library button', () => {
      const button = service.createAddToLibraryButton(
        'media123',
        MediaType.SERIES,
        'test-correlation',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'add_library:test-correlation:series:media123',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Add to Library')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Success)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('📚')
    })
  })

  describe('createViewDetailsButton', () => {
    it('should create view details button', () => {
      const button = service.createViewDetailsButton(
        'media123',
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'view_details:test-correlation:movie:media123',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Details')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(
        ButtonStyle.Secondary,
      )
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('ℹ️')
    })
  })

  describe('createRefreshButton', () => {
    it('should create refresh button', () => {
      const button = service.createRefreshButton(
        'search-context',
        'test-correlation',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'refresh:test-correlation:search-context',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Refresh')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(
        ButtonStyle.Secondary,
      )
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('🔄')
    })
  })

  describe('createCancelButton', () => {
    it('should create cancel button', () => {
      const button = service.createCancelButton('test-correlation')

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'cancel:test-correlation',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Cancel')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Danger)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('❌')
    })
  })

  describe('createConfirmButton', () => {
    it('should create confirm button', () => {
      const button = service.createConfirmButton(
        'delete-action',
        'test-correlation',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'confirm:test-correlation:delete-action',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Confirm')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Success)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('✅')
    })
  })

  describe('createPaginationButtons', () => {
    beforeEach(() => {
      // Clear previous mock calls
      mockButtonBuilder.mockClear()
    })

    it('should create pagination buttons for first page', () => {
      const buttons = service.createPaginationButtons(
        0,
        5,
        'search-results',
        'test-correlation',
      )

      expect(mockButtonBuilder).toHaveBeenCalledTimes(5) // first, previous, next, last, pageInfo

      // Verify button structure
      expect(buttons).toHaveProperty('first')
      expect(buttons).toHaveProperty('previous')
      expect(buttons).toHaveProperty('next')
      expect(buttons).toHaveProperty('last')
      expect(buttons).toHaveProperty('pageInfo')

      // Check that disabled state was set for first/previous buttons
      expect(buttons.first.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.previous.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.next.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.last.setDisabled).toHaveBeenCalledWith(false)
    })

    it('should create pagination buttons for middle page', () => {
      const buttons = service.createPaginationButtons(
        2,
        5,
        'search-results',
        'test-correlation',
      )

      expect(buttons.first.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.previous.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.next.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.last.setDisabled).toHaveBeenCalledWith(false)
    })

    it('should create pagination buttons for last page', () => {
      const buttons = service.createPaginationButtons(
        4,
        5,
        'search-results',
        'test-correlation',
      )

      expect(buttons.first.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.previous.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.next.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.last.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should create pagination buttons for single page', () => {
      const buttons = service.createPaginationButtons(
        0,
        1,
        'search-results',
        'test-correlation',
      )

      expect(buttons.first.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.previous.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.next.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.last.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should have correct custom IDs for pagination buttons', () => {
      const buttons = service.createPaginationButtons(
        2,
        5,
        'search-results',
        'test-correlation',
      )

      expect(buttons.first.setCustomId).toHaveBeenCalledWith(
        'pagination:test-correlation:search-results:first',
      )
      expect(buttons.previous.setCustomId).toHaveBeenCalledWith(
        'pagination:test-correlation:search-results:prev:1',
      )
      expect(buttons.next.setCustomId).toHaveBeenCalledWith(
        'pagination:test-correlation:search-results:next:3',
      )
      expect(buttons.last.setCustomId).toHaveBeenCalledWith(
        'pagination:test-correlation:search-results:last',
      )
    })
  })

  describe('createMediaActionButtons', () => {
    beforeEach(() => {
      mockButtonBuilder.mockClear()
    })

    it('should create media action buttons with available actions', () => {
      const availableActions = [
        ActionType.PLAY,
        ActionType.DOWNLOAD,
        ActionType.MONITOR,
      ]
      const buttons = service.createMediaActionButtons(
        'media123',
        MediaType.MOVIE,
        availableActions,
        'test-correlation',
      )

      expect(mockButtonBuilder).toHaveBeenCalledTimes(6) // All action button types

      // Verify available actions are not disabled
      expect(buttons.play.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.download.setDisabled).toHaveBeenCalledWith(false)
      expect(buttons.monitor.setDisabled).toHaveBeenCalledWith(false)

      // Verify unavailable actions are disabled
      expect(buttons.delete.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.unmonitor.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.search.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should create media action buttons with all actions disabled', () => {
      const buttons = service.createMediaActionButtons(
        'media123',
        MediaType.MOVIE,
        [],
        'test-correlation',
      )

      // All buttons should be disabled
      Object.values(buttons).forEach(button => {
        expect(button.setDisabled).toHaveBeenCalledWith(true)
      })
    })

    it('should have correct styling and emojis for action buttons', () => {
      const buttons = service.createMediaActionButtons(
        'media123',
        MediaType.MOVIE,
        Object.values(ActionType),
        'test-correlation',
      )

      expect(buttons.play.setStyle).toHaveBeenCalledWith(ButtonStyle.Primary)
      expect(buttons.play.setEmoji).toHaveBeenCalledWith('▶️')
      expect(buttons.download.setStyle).toHaveBeenCalledWith(
        ButtonStyle.Success,
      )
      expect(buttons.download.setEmoji).toHaveBeenCalledWith('⬇️')
      expect(buttons.delete.setStyle).toHaveBeenCalledWith(ButtonStyle.Danger)
      expect(buttons.delete.setEmoji).toHaveBeenCalledWith('🗑️')
    })
  })

  describe('createUrlButton', () => {
    it('should create URL button', () => {
      const button = service.createUrlButton(
        'Visit Site',
        'https://example.com',
        '🌐',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Visit Site')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Link)
      expect(buttonInstance.setURL).toHaveBeenCalledWith('https://example.com')
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('🌐')
    })

    it('should create URL button without emoji', () => {
      const button = service.createUrlButton(
        'Visit Site',
        'https://example.com',
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setEmoji).not.toHaveBeenCalled()
    })

    it('should truncate long labels', () => {
      const longLabel = 'a'.repeat(50)
      const button = service.createUrlButton(longLabel, 'https://example.com')

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      const labelCall = buttonInstance.setLabel.mock.calls[0][0]
      expect(labelCall).toHaveLength(45)
      expect(labelCall.endsWith('...')).toBe(true)
    })
  })

  describe('createEmbyPlaybackButton', () => {
    it('should create Emby playback button', () => {
      const button = service.createEmbyPlaybackButton(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Play in Emby')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Link)
      expect(buttonInstance.setURL).toHaveBeenCalledWith(
        'https://emby.example.com/web/index.html#!/item?id=media123',
      )
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('📺')
    })

    it('should handle missing EMBY_BASE_URL environment variable', () => {
      delete process.env.EMBY_BASE_URL
      const button = service.createEmbyPlaybackButton(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setURL).toHaveBeenCalledWith(
        'undefined/web/index.html#!/item?id=media123',
      )
    })
  })

  describe('createButton', () => {
    it('should create button from config', () => {
      const config: ButtonConfig = {
        customId: 'test-button',
        label: 'Test Button',
        style: ButtonStyle.Primary,
        emoji: '🎉',
      }

      const button = service.createButton(config)

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith('test-button')
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Test Button')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Primary)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('🎉')
      expect(buttonInstance.setDisabled).not.toHaveBeenCalled()
    })

    it('should create disabled button from config', () => {
      const config: ButtonConfig = {
        customId: 'test-button',
        label: 'Test Button',
        style: ButtonStyle.Secondary,
        disabled: true,
      }

      const button = service.createButton(config)

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should create URL button from config', () => {
      const config: ButtonConfig = {
        customId: 'test-button',
        label: 'External Link',
        style: ButtonStyle.Secondary,
        url: 'https://example.com',
      }

      const button = service.createButton(config)

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Link) // Should override to Link style
      expect(buttonInstance.setURL).toHaveBeenCalledWith('https://example.com')
    })

    it('should truncate long custom IDs and labels in config', () => {
      const config: ButtonConfig = {
        customId: 'a'.repeat(150),
        label: 'b'.repeat(60),
        style: ButtonStyle.Primary,
      }

      const button = service.createButton(config)

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      const customIdCall = buttonInstance.setCustomId.mock.calls[0][0]
      const labelCall = buttonInstance.setLabel.mock.calls[0][0]

      expect(customIdCall).toHaveLength(100)
      expect(labelCall).toHaveLength(45)
      expect(labelCall.endsWith('...')).toBe(true)
    })
  })

  describe('createContextButtons', () => {
    beforeEach(() => {
      mockButtonBuilder.mockClear()
    })

    it('should create context buttons for media not in library', () => {
      const buttons = service.createContextButtons(
        'media123',
        MediaType.MOVIE,
        false, // not in library
        false,
        false,
        'test-correlation',
      )

      expect(buttons).toHaveLength(3) // request, details, refresh
      expect(mockButtonBuilder).toHaveBeenCalledTimes(3)
    })

    it('should create context buttons for monitored media with files', () => {
      const buttons = service.createContextButtons(
        'media123',
        MediaType.MOVIE,
        true, // in library
        true, // monitored
        true, // has files
        'test-correlation',
      )

      expect(buttons).toHaveLength(5) // emby play, unmonitor, search, details, refresh
      expect(mockButtonBuilder).toHaveBeenCalledTimes(5)
    })

    it('should create context buttons for unmonitored media without files', () => {
      const buttons = service.createContextButtons(
        'media123',
        MediaType.SERIES,
        true, // in library
        false, // not monitored
        false, // no files
        'test-correlation',
      )

      expect(buttons).toHaveLength(4) // monitor, search, details, refresh
      expect(mockButtonBuilder).toHaveBeenCalledTimes(4)
    })

    it('should always include details and refresh buttons', () => {
      const scenarios = [
        { inLibrary: true, isMonitored: true, hasFiles: true },
        { inLibrary: true, isMonitored: false, hasFiles: false },
        { inLibrary: false, isMonitored: false, hasFiles: false },
      ]

      scenarios.forEach(scenario => {
        mockButtonBuilder.mockClear()

        const buttons = service.createContextButtons(
          'media123',
          MediaType.MOVIE,
          scenario.inLibrary,
          scenario.isMonitored,
          scenario.hasFiles,
          'test-correlation',
        )

        expect(buttons.length).toBeGreaterThanOrEqual(2)
        expect(mockButtonBuilder).toHaveBeenCalled()
      })
    })
  })

  describe('getConstraints', () => {
    it('should return a copy of constraints', () => {
      const constraints = service.getConstraints()

      expect(constraints).toEqual({
        maxActionRows: 5,
        maxComponentsPerRow: 5,
        maxSelectMenuOptions: 25,
        maxSelectMenuValues: 25,
        maxButtonsPerRow: 5,
        maxTextInputsPerModal: 5,
        maxTextInputLength: 4000,
        maxLabelLength: 45,
        maxPlaceholderLength: 100,
        maxCustomIdLength: 100,
      })

      // Verify it's a copy and not the original
      ;(constraints as any).maxButtonsPerRow = 10
      expect(service.getConstraints().maxButtonsPerRow).toBe(5)
    })
  })

  describe('Text truncation methods', () => {
    describe('truncateLabel (private method)', () => {
      it('should truncate labels to max length', () => {
        const longLabel = 'a'.repeat(60)
        // Access private method through any cast for testing
        const truncated = (service as any).truncateLabel(longLabel)

        expect(truncated).toHaveLength(45)
        expect(truncated.endsWith('...')).toBe(true)
      })

      it('should not truncate short labels', () => {
        const shortLabel = 'Short'
        const truncated = (service as any).truncateLabel(shortLabel)

        expect(truncated).toBe(shortLabel)
      })
    })

    describe('truncateCustomId (private method)', () => {
      it('should truncate custom IDs to max length without suffix', () => {
        const longCustomId = 'a'.repeat(150)
        const truncated = (service as any).truncateCustomId(longCustomId)

        expect(truncated).toHaveLength(100)
        expect(truncated.includes('...')).toBe(false)
      })

      it('should not truncate short custom IDs', () => {
        const shortCustomId = 'short-id'
        const truncated = (service as any).truncateCustomId(shortCustomId)

        expect(truncated).toBe(shortCustomId)
      })
    })

    describe('truncateText (private method)', () => {
      it('should truncate text with default suffix', () => {
        const longText = 'a'.repeat(50)
        const truncated = (service as any).truncateText(longText, 20)

        expect(truncated).toHaveLength(20)
        expect(truncated.endsWith('...')).toBe(true)
      })

      it('should truncate text with custom suffix', () => {
        const longText = 'a'.repeat(50)
        const truncated = (service as any).truncateText(longText, 15, '[cut]')

        expect(truncated).toHaveLength(15)
        expect(truncated.endsWith('[cut]')).toBe(true)
      })

      it('should handle edge cases', () => {
        const text = 'test'
        expect((service as any).truncateText(text, 10)).toBe(text)
        expect((service as any).truncateText(text, 4)).toBe(text)
        expect((service as any).truncateText(text, 3)).toBe('...')
      })
    })
  })

  describe('createActionButton (private method)', () => {
    beforeEach(() => {
      mockButtonBuilder.mockClear()
    })

    it('should create action button for known action type', () => {
      const button = (service as any).createActionButton(
        ActionType.PLAY,
        'base:id',
        [ActionType.PLAY],
      )

      expect(button).toBeDefined()

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith('base:id:play')
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Play')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(ButtonStyle.Primary)
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('▶️')
      expect(buttonInstance.setDisabled).toHaveBeenCalledWith(false)
    })

    it('should create disabled action button for unavailable action', () => {
      const button = (service as any).createActionButton(
        ActionType.DELETE,
        'base:id',
        [ActionType.PLAY], // DELETE is not in available actions
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should handle unknown action type with default config', () => {
      const unknownAction = 'unknown_action' as ActionType
      const button = (service as any).createActionButton(
        unknownAction,
        'base:id',
        [],
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('unknown_action')
      expect(buttonInstance.setEmoji).toHaveBeenCalledWith('⚙️')
      expect(buttonInstance.setStyle).toHaveBeenCalledWith(
        ButtonStyle.Secondary,
      )
    })
  })

  describe('Edge cases and boundary conditions', () => {
    beforeEach(() => {
      mockButtonBuilder.mockClear()
    })

    it('should handle extremely long correlation IDs', () => {
      const veryLongCorrelationId = 'x'.repeat(200)
      const button = service.createSearchButton(
        MediaType.MOVIE,
        veryLongCorrelationId,
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      const customIdCall = buttonInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toHaveLength(100)
    })

    it('should handle special characters in media IDs', () => {
      const specialMediaId = 'media:with/special\\chars'
      const button = service.createRequestButton(
        specialMediaId,
        MediaType.MOVIE,
        'Test Movie',
        'correlation',
      )

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      const customIdCall = buttonInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toContain(specialMediaId)
    })

    it('should handle empty strings gracefully', () => {
      const button = service.createRefreshButton('', '')

      const buttonInstance = mockButtonBuilder.mock.results[0].value
      expect(buttonInstance.setCustomId).toHaveBeenCalledWith(
        'refresh:unknown:',
      )
      expect(buttonInstance.setLabel).toHaveBeenCalledWith('Refresh')
    })

    it('should handle pagination with zero pages', () => {
      const buttons = service.createPaginationButtons(
        0,
        0,
        'context',
        'correlation',
      )

      expect(buttons.pageInfo.setLabel).toHaveBeenCalledWith('1/0')
      expect(buttons.next.setDisabled).toHaveBeenCalledWith(true)
      expect(buttons.last.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should handle all action types in media action buttons', () => {
      const allActions = Object.values(ActionType)
      const buttons = service.createMediaActionButtons(
        'media123',
        MediaType.MOVIE,
        allActions,
        'correlation',
      )

      // All buttons should be enabled when all actions are available
      Object.values(buttons).forEach(button => {
        expect(button.setDisabled).toHaveBeenCalledWith(false)
      })
    })

    it('should maintain button configuration integrity', () => {
      const button1 = service.createSearchButton(MediaType.MOVIE, 'corr1')
      const button2 = service.createCancelButton('corr2')

      const button1Instance = mockButtonBuilder.mock.results[0].value
      const button2Instance = mockButtonBuilder.mock.results[1].value

      expect(button1Instance.setCustomId).toHaveBeenCalledWith(
        'search_action:corr1:movie',
      )
      expect(button2Instance.setCustomId).toHaveBeenCalledWith('cancel:corr2')
      expect(button1Instance.setStyle).toHaveBeenCalledWith(ButtonStyle.Primary)
      expect(button2Instance.setStyle).toHaveBeenCalledWith(ButtonStyle.Danger)
    })
  })
})
