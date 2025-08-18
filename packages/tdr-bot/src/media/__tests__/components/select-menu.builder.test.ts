import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import {
  QualityProfileData,
  RootFolderData,
  SearchResultData,
  SelectMenuConfig,
  SelectMenuOption,
} from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    addOptions: jest.fn().mockReturnThis(),
    setMinValues: jest.fn().mockReturnThis(),
    setMaxValues: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
    data: {} as any,
  })),
  StringSelectMenuOptionBuilder: jest.fn().mockImplementation(() => ({
    setLabel: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setDefault: jest.fn().mockReturnThis(),
    data: {} as any,
  })),
}))

describe('SelectMenuBuilderService', () => {
  let service: SelectMenuBuilderService
  let loggerSpy: jest.SpyInstance
  let mockStringSelectMenuBuilder: jest.MockedClass<
    typeof StringSelectMenuBuilder
  >
  let mockStringSelectMenuOptionBuilder: jest.MockedClass<
    typeof StringSelectMenuOptionBuilder
  >

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      SelectMenuBuilderService,
    ])

    service = module.get<SelectMenuBuilderService>(SelectMenuBuilderService)

    mockStringSelectMenuBuilder = StringSelectMenuBuilder as jest.MockedClass<
      typeof StringSelectMenuBuilder
    >
    mockStringSelectMenuOptionBuilder =
      StringSelectMenuOptionBuilder as jest.MockedClass<
        typeof StringSelectMenuOptionBuilder
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

  describe('createSearchResultsMenu', () => {
    const mockSearchResults: SearchResultData[] = [
      {
        id: '1',
        title: 'Test Movie 1',
        year: 2021,
        overview: 'A test movie',
        mediaType: MediaType.MOVIE,
        inLibrary: false,
      },
      {
        id: '2',
        title: 'Test Movie 2',
        year: 2022,
        overview: 'Another test movie',
        mediaType: MediaType.MOVIE,
        inLibrary: true,
      },
      {
        id: '3',
        title: 'Test Series',
        year: 2023,
        overview: 'A test series',
        mediaType: MediaType.SERIES,
        inLibrary: false,
      },
    ]

    beforeEach(() => {
      mockStringSelectMenuBuilder.mockClear()
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    it('should create search results menu with pagination', () => {
      const menu = service.createSearchResultsMenu(
        mockSearchResults,
        0,
        10,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuBuilder).toHaveBeenCalled()

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'search_results:test-correlation:0',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select from 3 results (Page 1/1)',
      )
      expect(menuInstance.addOptions).toHaveBeenCalled()

      // Verify option builders were created for each result
      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(3)
    })

    it('should handle pagination correctly', () => {
      const largeResults = Array.from({ length: 25 }, (_, i) => ({
        id: `${i + 1}`,
        title: `Movie ${i + 1}`,
        year: 2021,
        mediaType: MediaType.MOVIE,
        inLibrary: false,
      }))

      const menu = service.createSearchResultsMenu(
        largeResults,
        1,
        10,
        'test-correlation',
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'search_results:test-correlation:1',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select from 10 results (Page 2/3)',
      )

      // Should create 10 options for page 2
      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(10)
    })

    it('should handle missing correlation ID', () => {
      const menu = service.createSearchResultsMenu(mockSearchResults)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'search_results:unknown:0',
      )
    })

    it('should log debug information', () => {
      service.createSearchResultsMenu(
        mockSearchResults,
        0,
        10,
        'test-correlation',
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Created search results select menu',
        {
          correlationId: 'test-correlation',
          page: 0,
          pageSize: 10,
          totalResults: 3,
          pageResults: 3,
          totalPages: 1,
          customId: 'search_results:test-correlation:0',
        },
      )
    })

    it('should handle empty results', () => {
      const menu = service.createSearchResultsMenu([])

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuOptionBuilder).not.toHaveBeenCalled()
    })

    it('should handle partial pages', () => {
      const menu = service.createSearchResultsMenu(mockSearchResults, 0, 2)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select from 2 results (Page 1/2)',
      )
      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(2)
    })

    it('should truncate long custom IDs', () => {
      const longCorrelationId = 'a'.repeat(100)
      const menu = service.createSearchResultsMenu(
        mockSearchResults,
        0,
        10,
        longCorrelationId,
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      const customIdCall = menuInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toHaveLength(100)
    })

    it('should truncate long placeholders', () => {
      const longTitleResults = Array.from({ length: 50 }, (_, i) => ({
        id: `${i + 1}`,
        title: `Very Long Movie Title That Exceeds Normal Length ${i + 1}`,
        year: 2021,
        mediaType: MediaType.MOVIE,
        inLibrary: false,
      }))

      const menu = service.createSearchResultsMenu(longTitleResults, 0, 50)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      const placeholderCall = menuInstance.setPlaceholder.mock.calls[0][0]
      expect(placeholderCall.length).toBeLessThanOrEqual(100)
    })
  })

  describe('createQualityProfilesMenu', () => {
    const mockQualityProfiles: QualityProfileData[] = [
      { id: 1, name: 'HD-1080p', isDefault: true },
      { id: 2, name: 'SD', isDefault: false },
      { id: 3, name: '4K Ultra HD', isDefault: false },
    ]

    beforeEach(() => {
      mockStringSelectMenuBuilder.mockClear()
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    it('should create quality profiles menu', () => {
      const menu = service.createQualityProfilesMenu(
        mockQualityProfiles,
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuBuilder).toHaveBeenCalled()

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'quality_profiles:test-correlation:movie',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select quality profile for movie',
      )
      expect(menuInstance.addOptions).toHaveBeenCalled()

      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(3)
    })

    it('should log debug information with default profile', () => {
      service.createQualityProfilesMenu(
        mockQualityProfiles,
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Created quality profiles select menu',
        {
          correlationId: 'test-correlation',
          mediaType: MediaType.MOVIE,
          profileCount: 3,
          defaultProfile: 'HD-1080p',
          customId: 'quality_profiles:test-correlation:movie',
        },
      )
    })

    it('should handle series media type', () => {
      const menu = service.createQualityProfilesMenu(
        mockQualityProfiles,
        MediaType.SERIES,
        'test-correlation',
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'quality_profiles:test-correlation:series',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select quality profile for series',
      )
    })

    it('should handle missing correlation ID', () => {
      const menu = service.createQualityProfilesMenu(
        mockQualityProfiles,
        MediaType.MOVIE,
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'quality_profiles:unknown:movie',
      )
    })

    it('should handle profiles without default', () => {
      const profilesWithoutDefault = mockQualityProfiles.map(p => ({
        ...p,
        isDefault: false,
      }))

      service.createQualityProfilesMenu(
        profilesWithoutDefault,
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Created quality profiles select menu',
        {
          correlationId: 'test-correlation',
          mediaType: MediaType.MOVIE,
          profileCount: 3,
          defaultProfile: undefined,
          customId: 'quality_profiles:test-correlation:movie',
        },
      )
    })

    it('should handle empty profiles array', () => {
      const menu = service.createQualityProfilesMenu(
        [],
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuOptionBuilder).not.toHaveBeenCalled()
    })
  })

  describe('createRootFoldersMenu', () => {
    const mockRootFolders: RootFolderData[] = [
      {
        id: 1,
        path: '/movies',
        freeSpace: 1024 * 1024 * 1024 * 100,
        accessible: true,
      },
      {
        id: 2,
        path: '/tv-shows',
        freeSpace: 1024 * 1024 * 1024 * 50,
        accessible: true,
      },
      { id: 3, path: '/archive', accessible: false },
    ]

    beforeEach(() => {
      mockStringSelectMenuBuilder.mockClear()
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    it('should create root folders menu excluding inaccessible folders', () => {
      const menu = service.createRootFoldersMenu(
        mockRootFolders,
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuBuilder).toHaveBeenCalled()

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'root_folders:test-correlation:movie',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select storage location for movie',
      )

      // Should only create options for accessible folders (2 out of 3)
      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(2)
    })

    it('should throw error when no accessible folders available', () => {
      const inaccessibleFolders = [
        { id: 1, path: '/movies', accessible: false },
        { id: 2, path: '/tv-shows', accessible: false },
      ]

      expect(() =>
        service.createRootFoldersMenu(
          inaccessibleFolders,
          MediaType.MOVIE,
          'test-correlation',
        ),
      ).toThrow('No accessible root folders available')
    })

    it('should handle folders with undefined accessibility (treated as accessible)', () => {
      const foldersWithUndefinedAccessibility = [
        { id: 1, path: '/movies', freeSpace: 1024 },
        { id: 2, path: '/tv-shows' },
      ]

      const menu = service.createRootFoldersMenu(
        foldersWithUndefinedAccessibility,
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(2)
    })

    it('should log debug information', () => {
      service.createRootFoldersMenu(
        mockRootFolders,
        MediaType.SERIES,
        'test-correlation',
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Created root folders select menu',
        {
          correlationId: 'test-correlation',
          mediaType: MediaType.SERIES,
          totalFolders: 3,
          accessibleFolders: 2,
          customId: 'root_folders:test-correlation:series',
        },
      )
    })

    it('should handle missing correlation ID', () => {
      const menu = service.createRootFoldersMenu(
        mockRootFolders,
        MediaType.MOVIE,
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'root_folders:unknown:movie',
      )
    })
  })

  describe('createSeasonsMenu', () => {
    const mockSeasons = [
      { number: 0, monitored: false, episodeCount: 5 },
      { number: 1, monitored: true, episodeCount: 12 },
      { number: 2, monitored: true, episodeCount: 10 },
      { number: 3, monitored: false, episodeCount: 8 },
    ]

    beforeEach(() => {
      mockStringSelectMenuBuilder.mockClear()
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    it('should create seasons menu with min/max values', () => {
      const menu = service.createSeasonsMenu(mockSeasons, 'test-correlation')

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuBuilder).toHaveBeenCalled()

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'seasons:test-correlation',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select seasons to monitor (4 available)',
      )
      expect(menuInstance.setMinValues).toHaveBeenCalledWith(1)
      expect(menuInstance.setMaxValues).toHaveBeenCalledWith(4)

      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(4)
    })

    it('should handle large number of seasons with max values constraint', () => {
      const manySeasons = Array.from({ length: 30 }, (_, i) => ({
        number: i + 1,
        monitored: false,
        episodeCount: 10,
      }))

      const menu = service.createSeasonsMenu(manySeasons, 'test-correlation')

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setMaxValues).toHaveBeenCalledWith(25) // constraint limit
    })

    it('should log debug information', () => {
      service.createSeasonsMenu(mockSeasons, 'test-correlation')

      expect(loggerSpy).toHaveBeenCalledWith('Created seasons select menu', {
        correlationId: 'test-correlation',
        seasonCount: 4,
        customId: 'seasons:test-correlation',
      })
    })

    it('should handle missing correlation ID', () => {
      const menu = service.createSeasonsMenu(mockSeasons)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith('seasons:unknown')
    })

    it('should handle empty seasons array', () => {
      const menu = service.createSeasonsMenu([], 'test-correlation')

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Select seasons to monitor (0 available)',
      )
      expect(menuInstance.setMaxValues).toHaveBeenCalledWith(0)

      expect(mockStringSelectMenuOptionBuilder).not.toHaveBeenCalled()
    })
  })

  describe('createMediaActionsMenu', () => {
    const mockAvailableActions = ['play', 'download', 'monitor', 'search']

    beforeEach(() => {
      mockStringSelectMenuBuilder.mockClear()
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    it('should create media actions menu', () => {
      const menu = service.createMediaActionsMenu(
        mockAvailableActions,
        'media123',
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuBuilder).toHaveBeenCalled()

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'media_actions:test-correlation:movie:media123',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Choose action for movie',
      )

      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(4)
    })

    it('should handle series media type', () => {
      const menu = service.createMediaActionsMenu(
        mockAvailableActions,
        'series456',
        MediaType.SERIES,
        'test-correlation',
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'media_actions:test-correlation:series:series456',
      )
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Choose action for series',
      )
    })

    it('should log debug information', () => {
      service.createMediaActionsMenu(
        mockAvailableActions,
        'media123',
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Created media actions select menu',
        {
          correlationId: 'test-correlation',
          mediaType: MediaType.MOVIE,
          mediaId: 'media123',
          actionCount: 4,
          customId: 'media_actions:test-correlation:movie:media123',
        },
      )
    })

    it('should handle missing correlation ID', () => {
      const menu = service.createMediaActionsMenu(
        mockAvailableActions,
        'media123',
        MediaType.MOVIE,
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith(
        'media_actions:unknown:movie:media123',
      )
    })

    it('should handle empty actions array', () => {
      const menu = service.createMediaActionsMenu(
        [],
        'media123',
        MediaType.MOVIE,
        'test-correlation',
      )

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuOptionBuilder).not.toHaveBeenCalled()
    })

    it('should truncate long custom IDs', () => {
      const longMediaId = 'a'.repeat(50)
      const longCorrelationId = 'b'.repeat(50)

      const menu = service.createMediaActionsMenu(
        mockAvailableActions,
        longMediaId,
        MediaType.MOVIE,
        longCorrelationId,
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      const customIdCall = menuInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toHaveLength(100)
    })
  })

  describe('createSelectMenu', () => {
    const mockConfig: SelectMenuConfig = {
      customId: 'test-menu',
      placeholder: 'Choose an option',
      options: [
        { label: 'Option 1', value: 'opt1', description: 'First option' },
        { label: 'Option 2', value: 'opt2', emoji: '🎉' },
        { label: 'Option 3', value: 'opt3', default: true },
      ],
      minValues: 1,
      maxValues: 2,
      disabled: false,
    }

    beforeEach(() => {
      mockStringSelectMenuBuilder.mockClear()
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    it('should create select menu from config', () => {
      const menu = service.createSelectMenu(mockConfig)

      expect(menu).toBeDefined()
      expect(mockStringSelectMenuBuilder).toHaveBeenCalled()

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setCustomId).toHaveBeenCalledWith('test-menu')
      expect(menuInstance.setPlaceholder).toHaveBeenCalledWith(
        'Choose an option',
      )
      expect(menuInstance.setMinValues).toHaveBeenCalledWith(1)
      expect(menuInstance.setMaxValues).toHaveBeenCalledWith(2)

      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(3)
    })

    it('should handle disabled menu', () => {
      const disabledConfig = { ...mockConfig, disabled: true }
      const menu = service.createSelectMenu(disabledConfig)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setDisabled).toHaveBeenCalledWith(true)
    })

    it('should handle menu without min/max values', () => {
      const { minValues, maxValues, ...configWithoutValues } = mockConfig
      const menu = service.createSelectMenu(configWithoutValues)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setMinValues).not.toHaveBeenCalled()
      expect(menuInstance.setMaxValues).not.toHaveBeenCalled()
    })

    it('should enforce max values constraint', () => {
      const configWithHighMaxValues = { ...mockConfig, maxValues: 30 }
      const menu = service.createSelectMenu(configWithHighMaxValues)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setMaxValues).toHaveBeenCalledWith(25) // constraint limit
    })

    it('should truncate long custom IDs and placeholders', () => {
      const longConfig = {
        ...mockConfig,
        customId: 'a'.repeat(150),
        placeholder: 'b'.repeat(120),
      }

      const menu = service.createSelectMenu(longConfig)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      const customIdCall = menuInstance.setCustomId.mock.calls[0][0]
      const placeholderCall = menuInstance.setPlaceholder.mock.calls[0][0]

      expect(customIdCall).toHaveLength(100)
      expect(placeholderCall).toHaveLength(100)
      expect(placeholderCall.endsWith('...')).toBe(true)
    })
  })

  describe('Private option creation methods', () => {
    beforeEach(() => {
      mockStringSelectMenuOptionBuilder.mockClear()
    })

    describe('createSearchResultOption', () => {
      it('should create option for movie result', () => {
        const movieResult: SearchResultData = {
          id: '1',
          title: 'Test Movie',
          year: 2021,
          overview: 'A great test movie',
          mediaType: MediaType.MOVIE,
          inLibrary: false,
        }

        // Access private method through any cast for testing
        const option = (service as any).createSearchResultOption(movieResult)

        expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalled()
        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith(
          'Test Movie (2021)',
        )
        expect(optionInstance.setValue).toHaveBeenCalledWith('movie:1')
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('🎬')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'A great test movie',
        )
      })

      it('should create option for series result', () => {
        const seriesResult: SearchResultData = {
          id: '2',
          title: 'Test Series',
          year: 2022,
          overview: 'A great test series',
          mediaType: MediaType.SERIES,
          inLibrary: false,
        }

        const option = (service as any).createSearchResultOption(seriesResult)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('📺')
      })

      it('should handle result already in library', () => {
        const inLibraryResult: SearchResultData = {
          id: '3',
          title: 'Existing Movie',
          year: 2023,
          overview: 'Already in library',
          mediaType: MediaType.MOVIE,
          inLibrary: true,
        }

        const option = (service as any).createSearchResultOption(
          inLibraryResult,
        )

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          '[In Library] Already in library',
        )
        expect(optionInstance.setDefault).toHaveBeenCalledWith(false)
      })

      it('should truncate long titles and descriptions', () => {
        const longResult: SearchResultData = {
          id: '4',
          title: 'A'.repeat(100),
          year: 2023,
          overview: 'B'.repeat(200),
          mediaType: MediaType.MOVIE,
          inLibrary: false,
        }

        const option = (service as any).createSearchResultOption(longResult)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        const labelCall = optionInstance.setLabel.mock.calls[0][0]
        const descriptionCall = optionInstance.setDescription.mock.calls[0][0]

        expect(labelCall.length).toBeLessThanOrEqual(45)
        expect(descriptionCall.length).toBeLessThanOrEqual(100)
      })

      it('should handle missing year and overview', () => {
        const minimalResult: SearchResultData = {
          id: '5',
          title: 'Minimal Movie',
          mediaType: MediaType.MOVIE,
          inLibrary: false,
        }

        const option = (service as any).createSearchResultOption(minimalResult)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('Minimal Movie')
        // Description is only called if there's content, so it may or may not be called
        expect(optionInstance.setValue).toHaveBeenCalledWith('movie:5')
      })
    })

    describe('createQualityProfileOption', () => {
      it('should create option for default quality profile', () => {
        const defaultProfile: QualityProfileData = {
          id: 1,
          name: 'HD-1080p',
          isDefault: true,
        }

        const option = (service as any).createQualityProfileOption(
          defaultProfile,
        )

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('HD-1080p')
        expect(optionInstance.setValue).toHaveBeenCalledWith('1')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Default quality profile',
        )
        expect(optionInstance.setDefault).toHaveBeenCalledWith(true)
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('⭐')
      })

      it('should create option for non-default quality profile', () => {
        const profile: QualityProfileData = {
          id: 2,
          name: 'SD',
          isDefault: false,
        }

        const option = (service as any).createQualityProfileOption(profile)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Quality profile ID: 2',
        )
        expect(optionInstance.setDefault).not.toHaveBeenCalled()
        expect(optionInstance.setEmoji).not.toHaveBeenCalled()
      })

      it('should truncate long profile names', () => {
        const longProfile: QualityProfileData = {
          id: 3,
          name: 'A'.repeat(60),
          isDefault: false,
        }

        const option = (service as any).createQualityProfileOption(longProfile)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        const labelCall = optionInstance.setLabel.mock.calls[0][0]
        expect(labelCall.length).toBeLessThanOrEqual(45)
        expect(labelCall.endsWith('...')).toBe(true)
      })
    })

    describe('createRootFolderOption', () => {
      it('should create option with free space information', () => {
        const folder: RootFolderData = {
          id: 1,
          path: '/movies',
          freeSpace: 1024 * 1024 * 1024 * 100, // 100GB
        }

        const option = (service as any).createRootFolderOption(folder)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('/movies')
        expect(optionInstance.setValue).toHaveBeenCalledWith('1')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Folder ID: 1 | 100GB free',
        )
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('📁')
      })

      it('should create option without free space information', () => {
        const folder: RootFolderData = {
          id: 2,
          path: '/tv-shows',
        }

        const option = (service as any).createRootFolderOption(folder)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Folder ID: 2',
        )
      })

      it('should truncate long paths and descriptions', () => {
        const longFolder: RootFolderData = {
          id: 3,
          path: '/very/long/path/that/exceeds/normal/length/for/folder/paths',
          freeSpace: 1024 * 1024 * 1024 * 1000, // 1000GB
        }

        const option = (service as any).createRootFolderOption(longFolder)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        const labelCall = optionInstance.setLabel.mock.calls[0][0]
        const descriptionCall = optionInstance.setDescription.mock.calls[0][0]

        expect(labelCall.length).toBeLessThanOrEqual(45)
        expect(descriptionCall.length).toBeLessThanOrEqual(100)
      })
    })

    describe('createSeasonOption', () => {
      it('should create option for regular season', () => {
        const season = { number: 1, monitored: true, episodeCount: 12 }

        const option = (service as any).createSeasonOption(season)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('Season 1')
        expect(optionInstance.setValue).toHaveBeenCalledWith('1')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          '12 episodes (currently monitored)',
        )
        expect(optionInstance.setDefault).toHaveBeenCalledWith(true)
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('👁️')
      })

      it('should create option for specials (season 0)', () => {
        const season = { number: 0, monitored: false, episodeCount: 5 }

        const option = (service as any).createSeasonOption(season)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('Specials')
        expect(optionInstance.setDescription).toHaveBeenCalledWith('5 episodes')
        expect(optionInstance.setDefault).not.toHaveBeenCalled()
        expect(optionInstance.setEmoji).not.toHaveBeenCalled()
      })

      it('should create option for unmonitored season', () => {
        const season = { number: 2, monitored: false, episodeCount: 8 }

        const option = (service as any).createSeasonOption(season)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setDescription).toHaveBeenCalledWith('8 episodes')
        expect(optionInstance.setDefault).not.toHaveBeenCalled()
      })
    })

    describe('createMediaActionOption', () => {
      it('should create option for known action', () => {
        const option = (service as any).createMediaActionOption('play')

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('Play')
        expect(optionInstance.setValue).toHaveBeenCalledWith('play')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Generate Emby playback link',
        )
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('▶️')
      })

      it('should create option for unknown action with fallback', () => {
        const option = (service as any).createMediaActionOption('custom_action')

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('custom_action')
        expect(optionInstance.setValue).toHaveBeenCalledWith('custom_action')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Perform custom_action action',
        )
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('⚙️')
      })

      it('should handle all predefined actions', () => {
        const actions = [
          'play',
          'download',
          'delete',
          'monitor',
          'unmonitor',
          'search',
          'refresh',
        ]

        actions.forEach((action, index) => {
          const option = (service as any).createMediaActionOption(action)
          const optionInstance =
            mockStringSelectMenuOptionBuilder.mock.results[index].value
          expect(optionInstance.setLabel).toHaveBeenCalled()
          expect(optionInstance.setValue).toHaveBeenCalledWith(action)
          expect(optionInstance.setDescription).toHaveBeenCalled()
          expect(optionInstance.setEmoji).toHaveBeenCalled()
        })
      })
    })

    describe('createOptionFromConfig', () => {
      it('should create option from full config', () => {
        const optionConfig: SelectMenuOption = {
          label: 'Test Option',
          value: 'test_value',
          description: 'Test description',
          emoji: '🎉',
          default: true,
        }

        const option = (service as any).createOptionFromConfig(optionConfig)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('Test Option')
        expect(optionInstance.setValue).toHaveBeenCalledWith('test_value')
        expect(optionInstance.setDescription).toHaveBeenCalledWith(
          'Test description',
        )
        expect(optionInstance.setEmoji).toHaveBeenCalledWith('🎉')
        expect(optionInstance.setDefault).toHaveBeenCalledWith(true)
      })

      it('should create option from minimal config', () => {
        const optionConfig: SelectMenuOption = {
          label: 'Minimal Option',
          value: 'minimal_value',
        }

        const option = (service as any).createOptionFromConfig(optionConfig)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        expect(optionInstance.setLabel).toHaveBeenCalledWith('Minimal Option')
        expect(optionInstance.setValue).toHaveBeenCalledWith('minimal_value')
        expect(optionInstance.setDescription).not.toHaveBeenCalled()
        expect(optionInstance.setEmoji).not.toHaveBeenCalled()
        expect(optionInstance.setDefault).not.toHaveBeenCalled()
      })

      it('should truncate long labels and descriptions', () => {
        const optionConfig: SelectMenuOption = {
          label: 'A'.repeat(60),
          value: 'test',
          description: 'B'.repeat(120),
        }

        const option = (service as any).createOptionFromConfig(optionConfig)

        const optionInstance =
          mockStringSelectMenuOptionBuilder.mock.results[0].value
        const labelCall = optionInstance.setLabel.mock.calls[0][0]
        const descriptionCall = optionInstance.setDescription.mock.calls[0][0]

        expect(labelCall.length).toBeLessThanOrEqual(45)
        expect(descriptionCall.length).toBeLessThanOrEqual(100)
        expect(labelCall.endsWith('...')).toBe(true)
        expect(descriptionCall.endsWith('...')).toBe(true)
      })
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

    describe('truncatePlaceholder', () => {
      it('should truncate placeholder with suffix', () => {
        const longPlaceholder = 'a'.repeat(120)
        const result = (service as any).truncatePlaceholder(longPlaceholder)

        expect(result).toHaveLength(100)
        expect(result.endsWith('...')).toBe(true)
      })

      it('should not truncate short placeholders', () => {
        const shortPlaceholder = 'Choose option'
        const result = (service as any).truncatePlaceholder(shortPlaceholder)

        expect(result).toBe(shortPlaceholder)
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
      ;(constraints as any).maxSelectMenuOptions = 50
      expect(service.getConstraints().maxSelectMenuOptions).toBe(25)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle null/undefined input gracefully', () => {
      expect(() => service.createSearchResultsMenu([] as any)).not.toThrow()
      expect(() =>
        service.createQualityProfilesMenu([] as any, MediaType.MOVIE),
      ).not.toThrow()
    })

    it('should handle extremely long correlation IDs', () => {
      const veryLongCorrelationId = 'x'.repeat(200)
      const menu = service.createSearchResultsMenu(
        [],
        0,
        10,
        veryLongCorrelationId,
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      const customIdCall = menuInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toHaveLength(100)
    })

    it('should handle special characters in IDs', () => {
      const specialCharsId = 'test:id/with\\special*chars'
      const menu = service.createMediaActionsMenu(
        ['play'],
        specialCharsId,
        MediaType.MOVIE,
        'correlation',
      )

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      const customIdCall = menuInstance.setCustomId.mock.calls[0][0]
      expect(customIdCall).toContain(specialCharsId)
    })

    it('should maintain consistent behavior across menu types', () => {
      const correlationId = 'consistent-test'

      service.createSearchResultsMenu([], 0, 10, correlationId)
      service.createQualityProfilesMenu([], MediaType.MOVIE, correlationId)

      // Verify that the correlation ID was used correctly in both cases
      expect(mockStringSelectMenuBuilder).toHaveBeenCalledTimes(2)

      // Check the setCustomId calls for both instances
      const firstMenuInstance =
        mockStringSelectMenuBuilder.mock.results[0].value
      const secondMenuInstance =
        mockStringSelectMenuBuilder.mock.results[1].value

      expect(firstMenuInstance.setCustomId).toHaveBeenCalledWith(
        expect.stringContaining(correlationId),
      )
      expect(secondMenuInstance.setCustomId).toHaveBeenCalledWith(
        expect.stringContaining(correlationId),
      )
    })

    it('should handle boundary values correctly', () => {
      // Test with exact constraint limits
      const exactLimitOptions = Array.from({ length: 25 }, (_, i) => ({
        label: `Option ${i + 1}`,
        value: `opt${i + 1}`,
      }))

      const config: SelectMenuConfig = {
        customId: 'boundary-test',
        placeholder: 'Test boundary',
        options: exactLimitOptions,
        maxValues: 25,
      }

      const menu = service.createSelectMenu(config)

      const menuInstance = mockStringSelectMenuBuilder.mock.results[0].value
      expect(menuInstance.setMaxValues).toHaveBeenCalledWith(25)
      expect(mockStringSelectMenuOptionBuilder).toHaveBeenCalledTimes(25)
    })
  })
})
