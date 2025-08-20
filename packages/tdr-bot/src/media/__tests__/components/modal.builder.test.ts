import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { ModalComponentConfig, ModalConfig } from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  ModalBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    addComponents: jest.fn().mockReturnThis(),
    data: { components: [] },
  })),
  TextInputBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    setRequired: jest.fn().mockReturnThis(),
    setMinLength: jest.fn().mockReturnThis(),
    setMaxLength: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    data: {},
  })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
  })),
  TextInputStyle: {
    Short: 1,
    Paragraph: 2,
  },
}))

describe('ModalBuilderService', () => {
  let service: ModalBuilderService
  let loggerSpy: jest.SpyInstance
  let mockModalBuilder: jest.MockedClass<typeof ModalBuilder>
  let mockTextInputBuilder: jest.MockedClass<typeof TextInputBuilder>
  let mockActionRowBuilder: jest.MockedClass<typeof ActionRowBuilder>

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ModalBuilderService,
    ])

    service = module.get<ModalBuilderService>(ModalBuilderService)

    mockModalBuilder = ModalBuilder as jest.MockedClass<typeof ModalBuilder>
    mockTextInputBuilder = TextInputBuilder as jest.MockedClass<
      typeof TextInputBuilder
    >
    mockActionRowBuilder = ActionRowBuilder as jest.MockedClass<
      typeof ActionRowBuilder
    >

    // Mock logger to avoid console output during tests
    loggerSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => {})
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('createSearchModal', () => {
    beforeEach(() => {
      mockModalBuilder.mockClear()
      mockTextInputBuilder.mockClear()
      mockActionRowBuilder.mockClear()
    })

    it('should create search modal for movies', () => {
      const modal = service.createSearchModal(
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(modal).toBeDefined()
      expect(mockModalBuilder).toHaveBeenCalled()

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'search_modal:test-correlation:movie',
      )
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Search Movies')
      expect(modalInstance.addComponents).toHaveBeenCalled()

      // Should create 2 text inputs (search term and year)
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(2)
      // Should create 2 action rows
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(2)
    })

    it('should create search modal for series', () => {
      const modal = service.createSearchModal(
        MediaType.SERIES,
        'test-correlation',
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'search_modal:test-correlation:series',
      )
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Search TV Series')
    })

    it('should handle missing correlation ID', () => {
      const modal = service.createSearchModal(MediaType.MOVIE)

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'search_modal:unknown:movie',
      )
    })

    it('should configure search term input correctly', () => {
      service.createSearchModal(MediaType.MOVIE, 'test-correlation')

      const searchInputInstance = mockTextInputBuilder.mock.results[0].value
      expect(searchInputInstance.setCustomId).toHaveBeenCalledWith(
        'search_term',
      )
      expect(searchInputInstance.setLabel).toHaveBeenCalledWith('Search Query')
      expect(searchInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(searchInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Enter movie title, year, or IMDB/TMDB ID...',
      )
      expect(searchInputInstance.setRequired).toHaveBeenCalledWith(true)
      expect(searchInputInstance.setMinLength).toHaveBeenCalledWith(1)
      expect(searchInputInstance.setMaxLength).toHaveBeenCalledWith(100)
    })

    it('should configure year input correctly', () => {
      service.createSearchModal(MediaType.SERIES, 'test-correlation')

      const yearInputInstance = mockTextInputBuilder.mock.results[1].value
      expect(yearInputInstance.setCustomId).toHaveBeenCalledWith('year')
      expect(yearInputInstance.setLabel).toHaveBeenCalledWith('Year (Optional)')
      expect(yearInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(yearInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'e.g., 2023',
      )
      expect(yearInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(yearInputInstance.setMinLength).toHaveBeenCalledWith(4)
      expect(yearInputInstance.setMaxLength).toHaveBeenCalledWith(4)
    })

    it('should log debug information', () => {
      service.createSearchModal(MediaType.MOVIE, 'test-correlation')

      expect(loggerSpy).toHaveBeenCalledWith('Created search modal', {
        correlationId: 'test-correlation',
        mediaType: MediaType.MOVIE,
        customId: 'search_modal:test-correlation:movie',
        title: 'Search Movies',
      })
    })

    it('should truncate long custom IDs and titles', () => {
      const longCorrelationId = 'a'.repeat(100)
      const modal = service.createSearchModal(
        MediaType.MOVIE,
        longCorrelationId,
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      const customIdCall = modalInstance.setCustomId.mock.calls[0][0]
      const titleCall = modalInstance.setTitle.mock.calls[0][0]

      expect(customIdCall).toHaveLength(100)
      expect(titleCall.length).toBeLessThanOrEqual(45)
    })
  })

  describe('createRequestModal', () => {
    beforeEach(() => {
      mockModalBuilder.mockClear()
      mockTextInputBuilder.mockClear()
      mockActionRowBuilder.mockClear()
    })

    it('should create request modal for movie', () => {
      const modal = service.createRequestModal(
        'movie123',
        MediaType.MOVIE,
        'Test Movie',
        'test-correlation',
      )

      expect(modal).toBeDefined()
      expect(mockModalBuilder).toHaveBeenCalled()

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'request_modal:test-correlation:movie:movie123',
      )
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Request Movie')

      // Should create 3 text inputs for movies (quality, root folder, tags)
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(3)
      // Should create 3 action rows
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(3)
    })

    it('should create request modal for series with episode input', () => {
      const modal = service.createRequestModal(
        'series456',
        MediaType.SERIES,
        'Test Series',
        'test-correlation',
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'request_modal:test-correlation:series:series456',
      )
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Request Series')

      // Should create 4 text inputs for series (quality, root folder, episodes, tags)
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(4)
      // Should create 4 action rows
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(4)
    })

    it('should configure quality profile input', () => {
      service.createRequestModal(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
        'test-correlation',
      )

      const qualityInputInstance = mockTextInputBuilder.mock.results[0].value
      expect(qualityInputInstance.setCustomId).toHaveBeenCalledWith(
        'quality_profile_id',
      )
      expect(qualityInputInstance.setLabel).toHaveBeenCalledWith(
        'Quality Profile ID',
      )
      expect(qualityInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(qualityInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Leave empty for default quality profile',
      )
      expect(qualityInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(qualityInputInstance.setMinLength).toHaveBeenCalledWith(1)
      expect(qualityInputInstance.setMaxLength).toHaveBeenCalledWith(10)
    })

    it('should configure root folder input', () => {
      service.createRequestModal(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
        'test-correlation',
      )

      const rootFolderInputInstance = mockTextInputBuilder.mock.results[1].value
      expect(rootFolderInputInstance.setCustomId).toHaveBeenCalledWith(
        'root_folder_path',
      )
      expect(rootFolderInputInstance.setLabel).toHaveBeenCalledWith(
        'Storage Location',
      )
      expect(rootFolderInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(rootFolderInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Leave empty for default folder',
      )
      expect(rootFolderInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(rootFolderInputInstance.setMaxLength).toHaveBeenCalledWith(200)
    })

    it('should configure episode input for series', () => {
      service.createRequestModal(
        'series456',
        MediaType.SERIES,
        'Test Series',
        'test-correlation',
      )

      const episodeInputInstance = mockTextInputBuilder.mock.results[2].value
      expect(episodeInputInstance.setCustomId).toHaveBeenCalledWith(
        'episode_spec',
      )
      expect(episodeInputInstance.setLabel).toHaveBeenCalledWith(
        'Episodes to Monitor',
      )
      expect(episodeInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(episodeInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'e.g., S1, S1E1-5, S1-3, or leave empty for all',
      )
      expect(episodeInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(episodeInputInstance.setMaxLength).toHaveBeenCalledWith(50)
    })

    it('should configure tags input', () => {
      service.createRequestModal(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
        'test-correlation',
      )

      // Tags input is the last one for movies (index 2)
      const tagsInputInstance = mockTextInputBuilder.mock.results[2].value
      expect(tagsInputInstance.setCustomId).toHaveBeenCalledWith('tags')
      expect(tagsInputInstance.setLabel).toHaveBeenCalledWith('Tags (Optional)')
      expect(tagsInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(tagsInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Comma-separated tags, e.g., family, action',
      )
      expect(tagsInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(tagsInputInstance.setMaxLength).toHaveBeenCalledWith(100)
    })

    it('should handle missing correlation ID', () => {
      const modal = service.createRequestModal(
        'media123',
        MediaType.MOVIE,
        'Test Movie',
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'request_modal:unknown:movie:media123',
      )
    })

    it('should respect max text inputs per modal constraint', () => {
      // This test ensures that even if more inputs are configured,
      // the service respects the constraint limit
      service.createRequestModal(
        'series456',
        MediaType.SERIES,
        'Test Series',
        'test-correlation',
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      const addComponentsCalls = modalInstance.addComponents.mock.calls

      // Should not exceed the constraint limit (5)
      expect(addComponentsCalls.length).toBeLessThanOrEqual(1)
      if (addComponentsCalls.length > 0) {
        const components = addComponentsCalls[0]
        expect(components.length).toBeLessThanOrEqual(5)
      }
    })

    it('should log debug information', () => {
      service.createRequestModal(
        'movie123',
        MediaType.MOVIE,
        'Test Movie',
        'test-correlation',
      )

      expect(loggerSpy).toHaveBeenCalledWith('Created request modal', {
        correlationId: 'test-correlation',
        mediaType: MediaType.MOVIE,
        mediaId: 'movie123',
        title: 'Test Movie',
        customId: 'request_modal:test-correlation:movie:movie123',
        componentCount: 3,
      })
    })

    it('should truncate long custom IDs', () => {
      const longMediaId = 'a'.repeat(50)
      const longCorrelationId = 'b'.repeat(50)

      const modal = service.createRequestModal(
        longMediaId,
        MediaType.MOVIE,
        'Test Movie',
        longCorrelationId,
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      const customIdCall = modalInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toHaveLength(100)
    })
  })

  describe('createEpisodeModal', () => {
    beforeEach(() => {
      mockModalBuilder.mockClear()
      mockTextInputBuilder.mockClear()
      mockActionRowBuilder.mockClear()
    })

    it('should create episode modal', () => {
      const modal = service.createEpisodeModal(
        'series123',
        'Test Series',
        'test-correlation',
      )

      expect(modal).toBeDefined()
      expect(mockModalBuilder).toHaveBeenCalled()

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'episode_modal:test-correlation:series123',
      )
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Episode Selection')

      // Should create 2 text inputs (episode specification and monitoring options)
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(2)
      // Should create 2 action rows
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(2)
    })

    it('should configure episode specification input', () => {
      service.createEpisodeModal('series123', 'Test Series', 'test-correlation')

      const episodeSpecInputInstance =
        mockTextInputBuilder.mock.results[0].value
      expect(episodeSpecInputInstance.setCustomId).toHaveBeenCalledWith(
        'episode_specification',
      )
      expect(episodeSpecInputInstance.setLabel).toHaveBeenCalledWith(
        'Episode Specification',
      )
      expect(episodeSpecInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Paragraph,
      )
      expect(episodeSpecInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Examples:\nS1 - Entire season 1\nS1E5 - Season 1, Episode 5\nS1E1-10 - Season 1, Episodes 1-10\nS1-3 - Seasons 1 through 3',
      )
      expect(episodeSpecInputInstance.setRequired).toHaveBeenCalledWith(true)
      expect(episodeSpecInputInstance.setMinLength).toHaveBeenCalledWith(2)
      expect(episodeSpecInputInstance.setMaxLength).toHaveBeenCalledWith(200)
    })

    it('should configure monitoring options input', () => {
      service.createEpisodeModal('series123', 'Test Series', 'test-correlation')

      const monitoringInputInstance = mockTextInputBuilder.mock.results[1].value
      expect(monitoringInputInstance.setCustomId).toHaveBeenCalledWith(
        'monitoring_options',
      )
      expect(monitoringInputInstance.setLabel).toHaveBeenCalledWith(
        'Monitoring Options',
      )
      expect(monitoringInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(monitoringInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'future, missing, existing, all (default: future)',
      )
      expect(monitoringInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(monitoringInputInstance.setMaxLength).toHaveBeenCalledWith(50)
    })

    it('should handle missing correlation ID', () => {
      const modal = service.createEpisodeModal('series123', 'Test Series')

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'episode_modal:unknown:series123',
      )
    })

    it('should log debug information', () => {
      service.createEpisodeModal('series123', 'Test Series', 'test-correlation')

      expect(loggerSpy).toHaveBeenCalledWith('Created episode modal', {
        correlationId: 'test-correlation',
        seriesId: 'series123',
        seriesTitle: 'Test Series',
        customId: 'episode_modal:test-correlation:series123',
      })
    })

    it('should truncate long custom IDs and titles', () => {
      const longSeriesId = 'a'.repeat(50)
      const longCorrelationId = 'b'.repeat(50)

      const modal = service.createEpisodeModal(
        longSeriesId,
        'Test Series',
        longCorrelationId,
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      const customIdCall = modalInstance.setCustomId.mock.calls[0][0]
      const titleCall = modalInstance.setTitle.mock.calls[0][0]

      expect(customIdCall).toHaveLength(100)
      expect(titleCall.length).toBeLessThanOrEqual(45)
    })
  })

  describe('createSettingsModal', () => {
    beforeEach(() => {
      mockModalBuilder.mockClear()
      mockTextInputBuilder.mockClear()
      mockActionRowBuilder.mockClear()
    })

    it('should create settings modal', () => {
      const modal = service.createSettingsModal(
        'media-management',
        'test-correlation',
      )

      expect(modal).toBeDefined()
      expect(mockModalBuilder).toHaveBeenCalled()

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'settings_modal:test-correlation:media-management',
      )
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Media Settings')

      // Should create 3 text inputs (default quality, default root folder, auto search)
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(3)
      // Should create 3 action rows
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(3)
    })

    it('should configure default quality profile input', () => {
      service.createSettingsModal('context', 'test-correlation')

      const defaultQualityInputInstance =
        mockTextInputBuilder.mock.results[0].value
      expect(defaultQualityInputInstance.setCustomId).toHaveBeenCalledWith(
        'default_quality_profile',
      )
      expect(defaultQualityInputInstance.setLabel).toHaveBeenCalledWith(
        'Default Quality Profile',
      )
      expect(defaultQualityInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(defaultQualityInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Quality profile name or ID',
      )
      expect(defaultQualityInputInstance.setRequired).toHaveBeenCalledWith(
        false,
      )
      expect(defaultQualityInputInstance.setMaxLength).toHaveBeenCalledWith(50)
    })

    it('should configure default root folder input', () => {
      service.createSettingsModal('context', 'test-correlation')

      const defaultRootFolderInputInstance =
        mockTextInputBuilder.mock.results[1].value
      expect(defaultRootFolderInputInstance.setCustomId).toHaveBeenCalledWith(
        'default_root_folder',
      )
      expect(defaultRootFolderInputInstance.setLabel).toHaveBeenCalledWith(
        'Default Root Folder',
      )
      expect(defaultRootFolderInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(
        defaultRootFolderInputInstance.setPlaceholder,
      ).toHaveBeenCalledWith('Default storage path')
      expect(defaultRootFolderInputInstance.setRequired).toHaveBeenCalledWith(
        false,
      )
      expect(defaultRootFolderInputInstance.setMaxLength).toHaveBeenCalledWith(
        200,
      )
    })

    it('should configure auto search settings input', () => {
      service.createSettingsModal('context', 'test-correlation')

      const autoSearchInputInstance = mockTextInputBuilder.mock.results[2].value
      expect(autoSearchInputInstance.setCustomId).toHaveBeenCalledWith(
        'auto_search_settings',
      )
      expect(autoSearchInputInstance.setLabel).toHaveBeenCalledWith(
        'Auto Search Settings',
      )
      expect(autoSearchInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Paragraph,
      )
      expect(autoSearchInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Enable auto search on add: true/false\nSearch delay (minutes): 5',
      )
      expect(autoSearchInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(autoSearchInputInstance.setMaxLength).toHaveBeenCalledWith(300)
    })

    it('should handle missing correlation ID', () => {
      const modal = service.createSettingsModal('context')

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith(
        'settings_modal:unknown:context',
      )
    })

    it('should log debug information', () => {
      service.createSettingsModal('media-management', 'test-correlation')

      expect(loggerSpy).toHaveBeenCalledWith('Created settings modal', {
        correlationId: 'test-correlation',
        context: 'media-management',
        customId: 'settings_modal:test-correlation:media-management',
      })
    })
  })

  describe('createModal', () => {
    const mockConfig: ModalConfig = {
      customId: 'test-modal',
      title: 'Test Modal',
      components: [
        {
          customId: 'input1',
          label: 'First Input',
          style: TextInputStyle.Short,
          placeholder: 'Enter first value',
          required: true,
          maxLength: 100,
        },
        {
          customId: 'input2',
          label: 'Second Input',
          style: TextInputStyle.Paragraph,
          placeholder: 'Enter description',
          required: false,
          minLength: 10,
          maxLength: 500,
          value: 'Default value',
        },
      ],
    }

    beforeEach(() => {
      mockModalBuilder.mockClear()
      mockTextInputBuilder.mockClear()
      mockActionRowBuilder.mockClear()
    })

    it('should create modal from config', () => {
      const modal = service.createModal(mockConfig)

      expect(modal).toBeDefined()
      expect(mockModalBuilder).toHaveBeenCalled()

      const modalInstance = mockModalBuilder.mock.results[0].value
      expect(modalInstance.setCustomId).toHaveBeenCalledWith('test-modal')
      expect(modalInstance.setTitle).toHaveBeenCalledWith('Test Modal')
      expect(modalInstance.addComponents).toHaveBeenCalled()

      // Should create 2 text inputs from config
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(2)
      // Should create 2 action rows
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(2)
    })

    it('should respect max text inputs per modal constraint', () => {
      const configWithManyInputs: ModalConfig = {
        customId: 'test-modal',
        title: 'Test Modal',
        components: Array.from({ length: 10 }, (_, i) => ({
          customId: `input${i}`,
          label: `Input ${i}`,
          style: TextInputStyle.Short,
        })),
      }

      const modal = service.createModal(configWithManyInputs)

      // Should only create 5 text inputs (constraint limit)
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(5)
      expect(mockActionRowBuilder).toHaveBeenCalledTimes(5)
    })

    it('should configure text inputs from component configs', () => {
      service.createModal(mockConfig)

      // First input configuration
      const firstInputInstance = mockTextInputBuilder.mock.results[0].value
      expect(firstInputInstance.setCustomId).toHaveBeenCalledWith('input1')
      expect(firstInputInstance.setLabel).toHaveBeenCalledWith('First Input')
      expect(firstInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(firstInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Enter first value',
      )
      expect(firstInputInstance.setRequired).toHaveBeenCalledWith(true)
      expect(firstInputInstance.setMaxLength).toHaveBeenCalledWith(100)

      // Second input configuration
      const secondInputInstance = mockTextInputBuilder.mock.results[1].value
      expect(secondInputInstance.setCustomId).toHaveBeenCalledWith('input2')
      expect(secondInputInstance.setLabel).toHaveBeenCalledWith('Second Input')
      expect(secondInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Paragraph,
      )
      expect(secondInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Enter description',
      )
      expect(secondInputInstance.setRequired).toHaveBeenCalledWith(false)
      expect(secondInputInstance.setMinLength).toHaveBeenCalledWith(10)
      expect(secondInputInstance.setMaxLength).toHaveBeenCalledWith(500)
      expect(secondInputInstance.setValue).toHaveBeenCalledWith('Default value')
    })

    it('should log debug information', () => {
      service.createModal(mockConfig)

      expect(loggerSpy).toHaveBeenCalledWith('Created modal from config', {
        customId: 'test-modal',
        title: 'Test Modal',
        componentCount: 2,
      })
    })

    it('should truncate long custom IDs and titles', () => {
      const longConfig: ModalConfig = {
        customId: 'a'.repeat(150),
        title: 'b'.repeat(60),
        components: [],
      }

      const modal = service.createModal(longConfig)

      const modalInstance = mockModalBuilder.mock.results[0].value
      const customIdCall = modalInstance.setCustomId.mock.calls[0][0]
      const titleCall = modalInstance.setTitle.mock.calls[0][0]

      expect(customIdCall).toHaveLength(100)
      expect(titleCall.length).toBeLessThanOrEqual(45)
      expect(titleCall.endsWith('...')).toBe(true)
    })

    it('should handle empty components array', () => {
      const emptyConfig: ModalConfig = {
        customId: 'empty-modal',
        title: 'Empty Modal',
        components: [],
      }

      const modal = service.createModal(emptyConfig)

      expect(modal).toBeDefined()
      expect(mockTextInputBuilder).not.toHaveBeenCalled()
      expect(mockActionRowBuilder).not.toHaveBeenCalled()
    })
  })

  describe('createTextInputs', () => {
    beforeEach(() => {
      mockTextInputBuilder.mockClear()
    })

    it('should create collection of predefined text inputs', () => {
      const textInputs = service.createTextInputs()

      expect(textInputs).toBeDefined()
      expect(textInputs).toHaveProperty('searchTerm')
      expect(textInputs).toHaveProperty('episodeSpec')
      expect(textInputs).toHaveProperty('customPath')
      expect(textInputs).toHaveProperty('tags')
      expect(textInputs).toHaveProperty('notes')

      // Should create 5 text inputs
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(5)
    })

    it('should configure search term input correctly', () => {
      const textInputs = service.createTextInputs()

      const searchTermInstance = mockTextInputBuilder.mock.results[0].value
      expect(searchTermInstance.setCustomId).toHaveBeenCalledWith('search_term')
      expect(searchTermInstance.setLabel).toHaveBeenCalledWith('Search Term')
      expect(searchTermInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(searchTermInstance.setPlaceholder).toHaveBeenCalledWith(
        'Enter search query...',
      )
      expect(searchTermInstance.setRequired).toHaveBeenCalledWith(true)
      expect(searchTermInstance.setMaxLength).toHaveBeenCalledWith(100)
    })

    it('should configure episode spec input correctly', () => {
      const textInputs = service.createTextInputs()

      const episodeSpecInstance = mockTextInputBuilder.mock.results[1].value
      expect(episodeSpecInstance.setCustomId).toHaveBeenCalledWith(
        'episode_spec',
      )
      expect(episodeSpecInstance.setLabel).toHaveBeenCalledWith(
        'Episode Specification',
      )
      expect(episodeSpecInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Paragraph,
      )
      expect(episodeSpecInstance.setPlaceholder).toHaveBeenCalledWith(
        'e.g., S1E1-10, S1-3, or leave empty for all',
      )
      expect(episodeSpecInstance.setRequired).toHaveBeenCalledWith(false)
      expect(episodeSpecInstance.setMaxLength).toHaveBeenCalledWith(200)
    })

    it('should configure custom path input correctly', () => {
      const textInputs = service.createTextInputs()

      const customPathInstance = mockTextInputBuilder.mock.results[2].value
      expect(customPathInstance.setCustomId).toHaveBeenCalledWith('custom_path')
      expect(customPathInstance.setLabel).toHaveBeenCalledWith('Custom Path')
      expect(customPathInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(customPathInstance.setPlaceholder).toHaveBeenCalledWith(
        '/path/to/media/folder',
      )
      expect(customPathInstance.setRequired).toHaveBeenCalledWith(false)
      expect(customPathInstance.setMaxLength).toHaveBeenCalledWith(300)
    })

    it('should configure tags input correctly', () => {
      const textInputs = service.createTextInputs()

      const tagsInstance = mockTextInputBuilder.mock.results[3].value
      expect(tagsInstance.setCustomId).toHaveBeenCalledWith('tags')
      expect(tagsInstance.setLabel).toHaveBeenCalledWith('Tags')
      expect(tagsInstance.setStyle).toHaveBeenCalledWith(TextInputStyle.Short)
      expect(tagsInstance.setPlaceholder).toHaveBeenCalledWith(
        'tag1, tag2, tag3',
      )
      expect(tagsInstance.setRequired).toHaveBeenCalledWith(false)
      expect(tagsInstance.setMaxLength).toHaveBeenCalledWith(100)
    })

    it('should configure notes input correctly', () => {
      const textInputs = service.createTextInputs()

      const notesInstance = mockTextInputBuilder.mock.results[4].value
      expect(notesInstance.setCustomId).toHaveBeenCalledWith('notes')
      expect(notesInstance.setLabel).toHaveBeenCalledWith('Notes')
      expect(notesInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Paragraph,
      )
      expect(notesInstance.setPlaceholder).toHaveBeenCalledWith(
        'Additional notes or comments...',
      )
      expect(notesInstance.setRequired).toHaveBeenCalledWith(false)
      expect(notesInstance.setMaxLength).toHaveBeenCalledWith(500)
    })
  })

  describe('createTextInput (private method)', () => {
    beforeEach(() => {
      mockTextInputBuilder.mockClear()
    })

    it('should create text input from config', () => {
      const inputConfig: ModalComponentConfig = {
        customId: 'test-input',
        label: 'Test Input',
        style: TextInputStyle.Short,
        placeholder: 'Enter test value',
        required: true,
        minLength: 5,
        maxLength: 100,
        value: 'default value',
      }

      const textInput = (service as any).createTextInput(inputConfig)

      expect(mockTextInputBuilder).toHaveBeenCalled()
      const textInputInstance = mockTextInputBuilder.mock.results[0].value

      expect(textInputInstance.setCustomId).toHaveBeenCalledWith('test-input')
      expect(textInputInstance.setLabel).toHaveBeenCalledWith('Test Input')
      expect(textInputInstance.setStyle).toHaveBeenCalledWith(
        TextInputStyle.Short,
      )
      expect(textInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'Enter test value',
      )
      expect(textInputInstance.setRequired).toHaveBeenCalledWith(true)
      expect(textInputInstance.setMinLength).toHaveBeenCalledWith(5)
      expect(textInputInstance.setMaxLength).toHaveBeenCalledWith(100)
      expect(textInputInstance.setValue).toHaveBeenCalledWith('default value')
    })

    it('should handle optional config properties', () => {
      const minimalConfig: ModalComponentConfig = {
        customId: 'minimal-input',
        label: 'Minimal Input',
        style: TextInputStyle.Short,
      }

      const textInput = (service as any).createTextInput(minimalConfig)

      const textInputInstance = mockTextInputBuilder.mock.results[0].value
      expect(textInputInstance.setPlaceholder).not.toHaveBeenCalled()
      expect(textInputInstance.setRequired).not.toHaveBeenCalled()
      expect(textInputInstance.setMinLength).not.toHaveBeenCalled()
      expect(textInputInstance.setMaxLength).not.toHaveBeenCalled()
      expect(textInputInstance.setValue).not.toHaveBeenCalled()
    })

    it('should enforce min length constraint', () => {
      const configWithNegativeMinLength: ModalComponentConfig = {
        customId: 'test-input',
        label: 'Test Input',
        style: TextInputStyle.Short,
        minLength: -5,
      }

      const textInput = (service as any).createTextInput(
        configWithNegativeMinLength,
      )

      const textInputInstance = mockTextInputBuilder.mock.results[0].value
      expect(textInputInstance.setMinLength).toHaveBeenCalledWith(0)
    })

    it('should enforce max length constraint', () => {
      const configWithHighMaxLength: ModalComponentConfig = {
        customId: 'test-input',
        label: 'Test Input',
        style: TextInputStyle.Short,
        maxLength: 5000, // Exceeds constraint limit of 4000
      }

      const textInput = (service as any).createTextInput(
        configWithHighMaxLength,
      )

      const textInputInstance = mockTextInputBuilder.mock.results[0].value
      expect(textInputInstance.setMaxLength).toHaveBeenCalledWith(4000)
    })

    it('should truncate long custom IDs, labels, and placeholders', () => {
      const longConfig: ModalComponentConfig = {
        customId: 'a'.repeat(150),
        label: 'b'.repeat(60),
        style: TextInputStyle.Short,
        placeholder: 'c'.repeat(120),
      }

      const textInput = (service as any).createTextInput(longConfig)

      const textInputInstance = mockTextInputBuilder.mock.results[0].value
      const customIdCall = textInputInstance.setCustomId.mock.calls[0][0]
      const labelCall = textInputInstance.setLabel.mock.calls[0][0]
      const placeholderCall = textInputInstance.setPlaceholder.mock.calls[0][0]

      expect(customIdCall).toHaveLength(100)
      expect(labelCall.length).toBeLessThanOrEqual(45)
      expect(placeholderCall.length).toBeLessThanOrEqual(100)
    })
  })

  describe('validateModal', () => {
    let mockModal: any

    beforeEach(() => {
      mockModal = {
        data: {
          custom_id: 'test-modal',
          title: 'Test Modal',
          components: [
            { type: 1, components: [{ type: 4 }] }, // ActionRow with TextInput
          ],
        },
      }
    })

    it('should return valid for properly configured modal', () => {
      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should return error for modal without custom_id', () => {
      delete mockModal.data.custom_id

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Modal must have a custom_id')
    })

    it('should return error for modal without title', () => {
      delete mockModal.data.title

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Modal must have a title')
    })

    it('should return error for modal without components', () => {
      delete mockModal.data.components

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Modal must have at least one component')
    })

    it('should return error for modal with empty components array', () => {
      mockModal.data.components = []

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Modal must have at least one component')
    })

    it('should return error for modal with too many components', () => {
      mockModal.data.components = Array.from({ length: 6 }, () => ({
        type: 1,
        components: [{ type: 4 }],
      }))

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Modal has too many components: 6 (max: 5)',
      )
    })

    it('should handle multiple validation errors', () => {
      delete mockModal.data.custom_id
      delete mockModal.data.title
      mockModal.data.components = []

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors).toContain('Modal must have a custom_id')
      expect(result.errors).toContain('Modal must have a title')
      expect(result.errors).toContain('Modal must have at least one component')
    })

    it('should validate modal with maximum allowed components', () => {
      mockModal.data.components = Array.from({ length: 5 }, () => ({
        type: 1,
        components: [{ type: 4 }],
      }))

      const result = service.validateModal(mockModal)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Text truncation methods', () => {
    describe('truncateText', () => {
      it('should return original text if within limit', () => {
        const text = 'Short text'
        const result = (service as any).truncateText(text, 20)

        expect(result).toBe(text)
      })

      it('should truncate text with default suffix', () => {
        const text = 'This is a very long text that needs to be truncated'
        const result = (service as any).truncateText(text, 20)

        expect(result).toBe('This is a very lo...')
        expect(result).toHaveLength(20)
      })

      it('should truncate text with custom suffix', () => {
        const text = 'This is a very long text'
        const result = (service as any).truncateText(text, 15, '[...]')

        expect(result).toBe('This is a [...]')
        expect(result).toHaveLength(15)
      })

      it('should handle edge cases', () => {
        const text = 'test'
        expect((service as any).truncateText(text, 10)).toBe(text)
        expect((service as any).truncateText(text, 4)).toBe(text)
        expect((service as any).truncateText(text, 3)).toBe('...')
      })
    })

    describe('truncateCustomId', () => {
      it('should truncate custom ID without suffix', () => {
        const longCustomId = 'a'.repeat(150)
        const result = (service as any).truncateCustomId(longCustomId)

        expect(result).toHaveLength(100)
        expect(result.includes('...')).toBe(false)
      })

      it('should not truncate short custom IDs', () => {
        const shortCustomId = 'short-id'
        const result = (service as any).truncateCustomId(shortCustomId)

        expect(result).toBe(shortCustomId)
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
      const mutableConstraints = constraints as any
      mutableConstraints.maxTextInputsPerModal = 10
      expect(service.getConstraints().maxTextInputsPerModal).toBe(5)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle null/undefined input gracefully', () => {
      const emptyConfig: ModalConfig = {
        customId: 'test',
        title: 'Test',
        components: [],
      }
      expect(() => service.createModal(emptyConfig)).not.toThrow()

      const mockModal = {
        data: {
          custom_id: 'test',
          title: 'Test',
          components: [],
        },
      } as any
      expect(() => service.validateModal(mockModal)).not.toThrow()
    })

    it('should handle extremely long correlation IDs across all methods', () => {
      const veryLongCorrelationId = 'x'.repeat(200)

      service.createSearchModal(MediaType.MOVIE, veryLongCorrelationId)
      service.createRequestModal(
        'media',
        MediaType.MOVIE,
        'title',
        veryLongCorrelationId,
      )
      service.createEpisodeModal('series', 'title', veryLongCorrelationId)
      service.createSettingsModal('context', veryLongCorrelationId)

      // All should have custom IDs truncated to 100 characters
      expect(mockModalBuilder).toHaveBeenCalledTimes(4)

      // Check each modal instance
      for (let i = 0; i < 4; i++) {
        const modalInstance = mockModalBuilder.mock.results[i].value
        const customIdCall = modalInstance.setCustomId.mock.calls[0][0]
        expect(customIdCall).toHaveLength(100)
      }
    })

    it('should handle special characters in IDs and contexts', () => {
      const specialCharsId = 'test:id/with\\special*chars'
      const modal = service.createRequestModal(
        specialCharsId,
        MediaType.MOVIE,
        'Test Movie',
        'correlation',
      )

      const modalInstance = mockModalBuilder.mock.results[0].value
      const customIdCall = modalInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toContain(specialCharsId)
    })

    it('should maintain consistent behavior across all modal types', () => {
      const correlationId = 'consistent-test'

      service.createSearchModal(MediaType.MOVIE, correlationId)
      service.createRequestModal(
        'media',
        MediaType.MOVIE,
        'title',
        correlationId,
      )
      service.createEpisodeModal('series', 'title', correlationId)
      service.createSettingsModal('context', correlationId)

      // All should have used the same correlation ID processing
      expect(mockModalBuilder).toHaveBeenCalledTimes(4)

      // Check each modal instance for correlation ID usage
      for (let i = 0; i < 4; i++) {
        const modalInstance = mockModalBuilder.mock.results[i].value
        expect(modalInstance.setCustomId).toHaveBeenCalledWith(
          expect.stringContaining(correlationId),
        )
      }
    })

    it('should handle boundary values correctly', () => {
      // Test with exact constraint limits
      const exactLimitConfig: ModalComponentConfig = {
        customId: 'a'.repeat(100), // Exact max length
        label: 'b'.repeat(45), // Exact max length
        style: TextInputStyle.Short,
        placeholder: 'c'.repeat(100), // Exact max length
        minLength: 0,
        maxLength: 4000, // Exact max length
      }

      const textInput = (service as any).createTextInput(exactLimitConfig)

      expect(mockTextInputBuilder).toHaveBeenCalled()
      const textInputInstance = mockTextInputBuilder.mock.results[0].value

      expect(textInputInstance.setCustomId).toHaveBeenCalledWith(
        'a'.repeat(100),
      )
      expect(textInputInstance.setLabel).toHaveBeenCalledWith('b'.repeat(45))
      expect(textInputInstance.setPlaceholder).toHaveBeenCalledWith(
        'c'.repeat(100),
      )
      expect(textInputInstance.setMinLength).toHaveBeenCalledWith(0)
      expect(textInputInstance.setMaxLength).toHaveBeenCalledWith(4000)
    })

    it('should handle validation on malformed modal data', () => {
      const malformedModal = {
        data: {
          custom_id: null,
          title: '',
          components: 'not-an-array',
        },
      }

      const result = service.validateModal(malformedModal as any)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should maintain component order and configuration integrity', () => {
      const config: ModalConfig = {
        customId: 'order-test',
        title: 'Order Test',
        components: [
          { customId: 'first', label: 'First', style: TextInputStyle.Short },
          {
            customId: 'second',
            label: 'Second',
            style: TextInputStyle.Paragraph,
          },
          { customId: 'third', label: 'Third', style: TextInputStyle.Short },
        ],
      }

      service.createModal(config)

      // Verify inputs were created in order
      expect(mockTextInputBuilder).toHaveBeenCalledTimes(3)

      const firstInstance = mockTextInputBuilder.mock.results[0].value
      const secondInstance = mockTextInputBuilder.mock.results[1].value
      const thirdInstance = mockTextInputBuilder.mock.results[2].value

      expect(firstInstance.setCustomId).toHaveBeenCalledWith('first')
      expect(secondInstance.setCustomId).toHaveBeenCalledWith('second')
      expect(thirdInstance.setCustomId).toHaveBeenCalledWith('third')
    })
  })
})
