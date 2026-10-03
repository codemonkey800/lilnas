import { HumanMessage } from '@langchain/core/messages'
import { DownloadApiError } from '@lilnas/utils/download/client'
import { mediaId } from '@lilnas/utils/download/media-id'
import {
  type DownloadJob,
  DownloadJobStatus,
  DownloadType,
  QualityTier,
  type RequestShowInput,
} from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { PromptGenerationService } from 'src/llm/skills/media/prompt-generation.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  SeriesSearchResult,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import { createMockShowJob } from 'src/media-operations/request-handling/__test-fixtures__/media-fixtures'
import {
  createMockDiscordIdentity,
  createMockDownloadClientFactory,
} from 'src/media-operations/request-handling/__test-helpers__/mock-services'
import { testStrategyEdgeCases } from 'src/media-operations/request-handling/__test-helpers__/strategy-edge-cases-suite'
import { testStrategyRouting } from 'src/media-operations/request-handling/__test-helpers__/strategy-routing-suite'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import {
  NOT_A_TITLE_REPLY,
  toShowRequestUnits,
  TvDownloadStrategy,
} from 'src/media-operations/request-handling/strategies/tv-download.strategy'
import {
  MediaContextType,
  StrategyRequestParams,
} from 'src/media-operations/request-handling/types/request-context.type'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { TvShowSelection } from 'src/schemas/tv-show'

describe('TvDownloadStrategy', () => {
  let strategy: TvDownloadStrategy
  let sonarrService: jest.Mocked<SonarrService>
  let downloadClientFactory: ReturnType<
    typeof createMockDownloadClientFactory
  >['factory']
  let downloadClient: ReturnType<
    typeof createMockDownloadClientFactory
  >['client']
  let promptService: jest.Mocked<PromptGenerationService>
  let parsingUtilities: jest.Mocked<ParsingUtilities>
  let selectionUtilities: jest.Mocked<SelectionUtilities>

  // Mock response messages
  const mockChatResponse = new HumanMessage({
    id: 'mock-response-id',
    content: 'Here is your TV show response...',
  })

  // Mock TV show search results
  const mockShow1: SeriesSearchResult = {
    tvdbId: 12345,
    tmdbId: 67890,
    imdbId: 'tt0944947',
    title: 'Breaking Bad',
    titleSlug: 'breaking-bad',
    year: 2008,
    overview:
      'A high school chemistry teacher turned methamphetamine producer...',
    runtime: 47,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
      { seasonNumber: 3, monitored: false },
    ],
    genres: ['Drama', 'Crime', 'Thriller'],
    rating: 9.5,
    posterPath: '/path/to/breaking-bad-poster.jpg',
    certification: 'TV-MA',
    ended: true,
  }

  const mockShow2: SeriesSearchResult = {
    tvdbId: 23456,
    tmdbId: 78901,
    imdbId: 'tt3032476',
    title: 'Better Call Saul',
    titleSlug: 'better-call-saul',
    year: 2015,
    overview: 'The trials and tribulations of criminal lawyer Jimmy McGill...',
    runtime: 46,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
    ],
    genres: ['Drama', 'Crime'],
    rating: 8.9,
    posterPath: '/path/to/better-call-saul-poster.jpg',
    certification: 'TV-MA',
    ended: true,
  }

  const mockShow3: SeriesSearchResult = {
    tvdbId: 34567,
    tmdbId: 89012,
    imdbId: 'tt2085059',
    title: 'Black Mirror',
    titleSlug: 'black-mirror',
    year: 2011,
    overview:
      'An anthology series exploring a twisted, high-tech multiverse...',
    runtime: 60,
    network: 'Netflix',
    status: SonarrSeriesStatus.CONTINUING,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
    ],
    genres: ['Science Fiction', 'Thriller', 'Drama'],
    rating: 8.8,
    posterPath: '/path/to/black-mirror-poster.jpg',
    certification: 'TV-MA',
    ended: false,
  }

  // Mock granular selections
  const mockEntireSeriesSelection: TvShowSelection = {
    selection: undefined,
  }

  const mockEntireSeriesSelectionEmptyArray: TvShowSelection = {
    selection: [],
  }

  const mockSeasonSelection: TvShowSelection = {
    selection: [{ season: 1 }],
  }

  const mockEpisodeSelection: TvShowSelection = {
    selection: [{ season: 1, episodes: [1, 2, 3] }],
  }

  const mockMultiSeasonSelection: TvShowSelection = {
    selection: [{ season: 1 }, { season: 2 }],
  }

  /**
   * The job the download app answers a request for `show` with - by default
   * still searching.
   */
  const showJob = (
    show: SeriesSearchResult,
    overrides: Partial<DownloadJob> = {},
  ): DownloadJob =>
    createMockShowJob({
      id: `job-${show.tvdbId}`,
      media: {
        id: mediaId({ type: DownloadType.Show, tvdbId: show.tvdbId }),
        title: show.title,
        tvdbId: show.tvdbId,
        type: DownloadType.Show,
        year: show.year,
      },
      ...overrides,
    })

  const mockRequestedJob = showJob(mockShow1)

  const mockFailedJob = showJob(mockShow1, {
    status: DownloadJobStatus.Failed,
    error: 'Sonarr has no "HD (up to 1080p)" quality profile',
  })

  const breakingBadLinks =
    'Follow along on the [activity page](<https://download.lilnas.io/activity>), or open [Breaking Bad](<https://download.lilnas.io/shows/12345>).'

  // Mock state object (passed in params, not DI) - context handling removed, now carried on StrategyResult.pendingContext
  const mockState = {}

  beforeEach(async () => {
    const mockDownload = createMockDownloadClientFactory()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TvDownloadStrategy,
        {
          provide: SonarrService,
          useValue: {
            searchShows: jest.fn(),
          },
        },
        {
          provide: DownloadClientFactory,
          useValue: mockDownload.factory,
        },
        {
          provide: PromptGenerationService,
          useValue: {
            generateTvShowChatResponse: jest.fn(),
          },
        },
        {
          provide: ParsingUtilities,
          useValue: {
            parseInitialSelection: jest.fn(),
            parseSearchSelection: jest.fn(),
            parseTvShowSelection: jest.fn(),
          },
        },
        {
          provide: SelectionUtilities,
          useValue: {
            findSelectedShow: jest.fn(),
          },
        },
      ],
    }).compile()

    strategy = module.get<TvDownloadStrategy>(TvDownloadStrategy)
    sonarrService = module.get(SonarrService)
    downloadClientFactory = module.get(DownloadClientFactory)
    downloadClient = mockDownload.client
    promptService = module.get(PromptGenerationService)
    parsingUtilities = module.get(ParsingUtilities)
    selectionUtilities = module.get(SelectionUtilities)
  })

  testStrategyRouting({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
        parseTvShowSelection: () => parsingUtilities.parseTvShowSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedShow,
      },
      mediaService: {
        searchOrLibraryMethod: () => sonarrService.searchShows,
        operationMethod: () => downloadClient.requestShow,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateTvShowChatResponse,
      },
    },
    fixtures: {
      validContext: {
        type: 'tvShow',
        isActive: true,
        searchResults: [mockShow1, mockShow2],
        query: 'breaking',
        timestamp: Date.now(),
      },
      mediaItems: [mockShow1, mockShow2, mockShow3],
      operationResult: mockRequestedJob,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'tv show',
      contextType: 'tvShow',
      wrongContextType: 'movie',
      inactiveContextType: 'tvShow',
      exampleMessage: 'download breaking bad',
    },
    mockState,
  })

  describe('New TV Show Search - Basic Flows', () => {
    it('asks for a title when the search query is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download some comedy shows',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: '',
        selection: null,
        tvSelection: null,
      })
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.searchShows).not.toHaveBeenCalled()
      expect(promptService.generateTvShowChatResponse).toHaveBeenCalledWith(
        [],
        'TV_SHOW_CLARIFICATION',
      )
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should return no_results message when no shows found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download nonexistent show',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'nonexistent',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
    })

    it('says a path-like term is not a title, without searching', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download /mnt/tv' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: '/mnt/tv',
        selection: null,
        tvSelection: null,
      })

      const result = await strategy.handleRequest(params)

      expect(sonarrService.searchShows).not.toHaveBeenCalled()
      expect(promptService.generateTvShowChatResponse).not.toHaveBeenCalled()
      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe(NOT_A_TITLE_REPLY)
      expect(result.images).toEqual([])
    })

    it('should store single show in context and ask for granular selection when no TV selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: undefined,
          originalTvSelection: undefined,
        },
      })
      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should store multiple shows in context and ask user to choose when multiple results found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download breaking' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([
        mockShow1,
        mockShow2,
        mockShow3,
      ])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow1, mockShow2, mockShow3],
          query: 'breaking',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: undefined,
          originalTvSelection: undefined,
        },
      })
      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should handle SonarrService search errors gracefully', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockRejectedValue(
        new Error('Sonarr service unavailable'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Search - Complete Auto-Selection (Ordinal + Granular)', () => {
    it('should auto-select show with ordinal and download when granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the second show, season 1',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '2' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([
        mockShow1,
        mockShow2,
        mockShow3,
      ])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      downloadClient.requestShow.mockResolvedValue(showJob(mockShow2))
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(downloadClient.requestShow).toHaveBeenCalledWith({
        tvdbId: mockShow2.tvdbId,
        seasonNumber: 1,
      })
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toContain(
        `[${mockShow2.title}](<https://download.lilnas.io/shows/${mockShow2.tvdbId}>)`,
      )
    })

    it('should fall back to list when auto-selection fails with invalid ordinal', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the 5th show, all episodes',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '5' },
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: { selectionType: 'ordinal', value: '5' },
          originalTvSelection: mockEntireSeriesSelection,
        },
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should return error when download fails during auto-selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the first show, season 1',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: { selectionType: 'ordinal', value: '1' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      downloadClient.requestShow.mockResolvedValue(mockFailedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should not store context when complete auto-selection succeeds', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the first show, all seasons',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '1' },
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
    })
  })

  describe('New TV Show Search - Complete Auto-Selection (Year + Granular)', () => {
    it('should auto-select by year and download when granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 2008, season 1',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([
        mockShow1,
        mockShow2,
        mockShow3,
      ])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to list when year match fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 1999, all episodes',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '1999' },
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.pendingContext).toBeDefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should return error when download fails during year auto-selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 2008, season 1',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      downloadClient.requestShow.mockResolvedValue(mockFailedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Search - Show-Only Auto-Selection', () => {
    it('should auto-select show with ordinal and store in context when no granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the second show',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '2' },
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow2],
          query: 'breaking',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: { selectionType: 'ordinal', value: '2' },
          originalTvSelection: undefined,
        },
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should auto-select by year and store in context when no granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 2008',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow1],
          query: 'breaking',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: { selectionType: 'year', value: '2008' },
          originalTvSelection: undefined,
        },
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to list when ordinal selection fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the 10th show',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '10' },
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: { selectionType: 'ordinal', value: '10' },
          originalTvSelection: undefined,
        },
      })
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Search - Single Result Scenarios', () => {
    it('should auto-download immediately when single result found with granular selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad season 1',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should store single result and ask for granular selection when no granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: {
          type: 'tvShow',
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: expect.any(Number),
          isActive: true,
          originalSearchSelection: undefined,
          originalTvSelection: undefined,
        },
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should return error message when single result download fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad all episodes',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      downloadClient.requestShow.mockResolvedValue(mockFailedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Selection from Context - Multiple Shows', () => {
    it('should parse ordinal selection and move to granular selection phase when show selected from context', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the first one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: expect.objectContaining({
          searchResults: [mockShow1],
        }),
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should parse year selection and move to granular selection phase when show selected from context', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: '2015' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '2015',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: expect.objectContaining({
          searchResults: [mockShow2],
        }),
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should auto-apply stored granular selection when show selected from context', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the second one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
          originalTvSelection: mockSeasonSelection,
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '2',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-prompt when selection is unparseable', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'something random' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockRejectedValue(
        new Error('Could not parse selection'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(selectionUtilities.findSelectedShow).not.toHaveBeenCalled()
      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-prompt when ordinal selection is out of range', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the fifth one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '5',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context when download succeeds with stored granular selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the first one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
          originalTvSelection: mockEntireSeriesSelection,
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
    })
  })

  describe('Selection from Context - Single Show Granular Selection', () => {
    it('should parse and apply entire series selection when selection is undefined', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'all episodes' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should parse and apply entire series selection when selection is empty array', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'everything' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelectionEmptyArray,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should parse and apply specific season selection when user provides season', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'season 1' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should parse and apply specific episode selection when user provides episodes', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'season 1 episodes 1, 2, 3',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEpisodeSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-prompt when granular selection is unparseable', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'random text' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockRejectedValue(
        new Error('Could not parse TV show selection'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(downloadClient.requestShow).not.toHaveBeenCalled()
      expect(result.pendingContext?.data).toEqual(params.context)
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context when download succeeds', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'season 1' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
    })
  })

  describe('Download Success and Failure', () => {
    it('should return success response when series download succeeds', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'all episodes' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
      expect(result.messages[0].content).toContain(
        'Follow along on the [activity page](<https://download.lilnas.io/activity>), or open [Breaking Bad](<https://download.lilnas.io/shows/12345>).',
      )
    })

    it('should return error response when series download fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'season 1' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockFailedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(promptService.generateTvShowChatResponse).toHaveBeenCalledWith(
        [],
        'TV_SHOW_ERROR',
        {
          selectedShow: mockShow1,
          errorMessage:
            'Requested "Breaking Bad", but nothing was queued: season 1: the request failed - Sonarr has no "HD (up to 1080p)" quality profile.',
        },
      )
      expect(result.messages).toHaveLength(1)
      // The job page offers Retry, so the links still help
      expect(result.messages[0].content).toBe(
        `Here is your TV show response...\n\n${breakingBadLinks}`,
      )
    })

    it('should handle errors gracefully when service throws exception during download', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'all episodes' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      downloadClient.requestShow.mockRejectedValue(new Error('Network error'))
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should request each selected season from the download app', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'seasons 1 and 2' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockMultiSeasonSelection,
      )
      downloadClient.requestShow.mockResolvedValue(mockRequestedJob)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(downloadClient.requestShow.mock.calls).toEqual([
        [{ tvdbId: 12345, seasonNumber: 1 }],
        [{ tvdbId: 12345, seasonNumber: 2 }],
      ])
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('toShowRequestUnits', () => {
    it('makes one whole-series request when nothing is selected', () => {
      expect(toShowRequestUnits(12345, undefined)).toEqual([{ tvdbId: 12345 }])
      expect(toShowRequestUnits(12345, null)).toEqual([{ tvdbId: 12345 }])
      expect(toShowRequestUnits(12345, mockEntireSeriesSelection)).toEqual([
        { tvdbId: 12345 },
      ])
      expect(
        toShowRequestUnits(12345, mockEntireSeriesSelectionEmptyArray),
      ).toEqual([{ tvdbId: 12345 }])
    })

    it('makes one request per selected season', () => {
      expect(
        toShowRequestUnits(12345, {
          selection: [{ season: 2 }, { season: 1, episodes: [] }],
        }),
      ).toEqual([
        { tvdbId: 12345, seasonNumber: 2 },
        { tvdbId: 12345, seasonNumber: 1 },
      ])
    })

    it('makes one request per selected episode, by season and number', () => {
      expect(toShowRequestUnits(12345, mockEpisodeSelection)).toEqual([
        { tvdbId: 12345, seasonNumber: 1, episodeNumber: 1 },
        { tvdbId: 12345, seasonNumber: 1, episodeNumber: 2 },
        { tvdbId: 12345, seasonNumber: 1, episodeNumber: 3 },
      ])
    })

    it('expands a mixed selection in the order it was given', () => {
      expect(
        toShowRequestUnits(12345, {
          selection: [
            { season: 1, episodes: [5, 6] },
            { season: 3 },
            { season: 2, episodes: [1] },
          ],
        }),
      ).toEqual([
        { tvdbId: 12345, seasonNumber: 1, episodeNumber: 5 },
        { tvdbId: 12345, seasonNumber: 1, episodeNumber: 6 },
        { tvdbId: 12345, seasonNumber: 3 },
        { tvdbId: 12345, seasonNumber: 2, episodeNumber: 1 },
      ])
    })

    it('keeps season 0 and episode 0 rather than treating them as unset', () => {
      expect(
        toShowRequestUnits(12345, {
          selection: [{ season: 0 }, { season: 0, episodes: [0] }],
        }),
      ).toEqual([
        { tvdbId: 12345, seasonNumber: 0 },
        { tvdbId: 12345, seasonNumber: 0, episodeNumber: 0 },
      ])
    })

    it('drops an exact repeat of an earlier unit', () => {
      expect(
        toShowRequestUnits(12345, {
          selection: [
            { season: 1 },
            { season: 1 },
            { season: 2, episodes: [3, 3] },
          ],
        }),
      ).toEqual([
        { tvdbId: 12345, seasonNumber: 1 },
        { tvdbId: 12345, seasonNumber: 2, episodeNumber: 3 },
      ])
    })

    it('puts the quality tier on every unit, and leaves it off when absent', () => {
      expect(
        toShowRequestUnits(12345, mockMultiSeasonSelection, QualityTier.Hd),
      ).toEqual([
        { tvdbId: 12345, seasonNumber: 1, qualityTier: QualityTier.Hd },
        { tvdbId: 12345, seasonNumber: 2, qualityTier: QualityTier.Hd },
      ])
      for (const unit of toShowRequestUnits(12345, mockMultiSeasonSelection)) {
        expect(unit).not.toHaveProperty('qualityTier')
      }
    })
  })

  describe('Requesting via the download app', () => {
    /** A granular pick for Breaking Bad, the one show in the context. */
    const pickParams = (
      overrides: Partial<StrategyRequestParams> = {},
    ): StrategyRequestParams => ({
      message: new HumanMessage({ id: '1', content: 'season 1' }),
      messages: [],
      userId: 'user123',
      discord: createMockDiscordIdentity('user123'),
      context: {
        type: 'tvShow',
        isActive: true,
        searchResults: [mockShow1],
        query: 'breaking bad',
        timestamp: Date.now(),
      },
      state: mockState,
      ...overrides,
    })

    const scopedJob = (
      unit: RequestShowInput,
      overrides: Partial<DownloadJob> = {},
    ): DownloadJob =>
      showJob(mockShow1, {
        id: `job-${unit.seasonNumber ?? 'all'}-${unit.episodeNumber ?? 'all'}`,
        scope: {
          ...(unit.seasonNumber != null
            ? { seasonNumber: unit.seasonNumber }
            : {}),
          ...(unit.episodeNumber != null
            ? { episodeNumber: unit.episodeNumber }
            : {}),
        },
        ...overrides,
      })

    const promptCall = () =>
      promptService.generateTvShowChatResponse.mock.calls[0]

    beforeEach(() => {
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )
      downloadClient.requestShow.mockImplementation(async unit =>
        scopedJob(unit),
      )
    })

    it("requests the whole series as the sender, leaving the tier to the server's default", async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )

      await strategy.handleRequest(pickParams())

      expect(downloadClientFactory.forDiscord).toHaveBeenCalledTimes(1)
      expect(downloadClientFactory.forDiscord).toHaveBeenCalledWith({
        userId: 'user123',
        username: 'testuser',
        displayName: 'Test User',
      })
      // Omitted outright, not sent as `qualityTier: undefined`
      expect(downloadClient.requestShow.mock.calls).toEqual([
        [{ tvdbId: 12345 }],
      ])
      expect(downloadClient.requestShow.mock.calls[0][0]).not.toHaveProperty(
        'qualityTier',
      )
    })

    it('passes the asked-for quality tier on every unit', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }, { season: 2, episodes: [4] }],
      })

      await strategy.handleRequest(
        pickParams({ qualityTier: QualityTier.UpTo4k }),
      )

      expect(downloadClient.requestShow.mock.calls).toEqual([
        [{ tvdbId: 12345, seasonNumber: 1, qualityTier: QualityTier.UpTo4k }],
        [
          {
            tvdbId: 12345,
            seasonNumber: 2,
            episodeNumber: 4,
            qualityTier: QualityTier.UpTo4k,
          },
        ],
      ])
    })

    it('sends the units one at a time, in selection order', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 2 }, { season: 1, episodes: [3, 4] }],
      })

      const events: string[] = []
      let inFlight = 0
      let maxInFlight = 0
      downloadClient.requestShow.mockImplementation(async unit => {
        const label = `${unit.seasonNumber}:${unit.episodeNumber ?? '*'}`
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        events.push(`start ${label}`)
        await new Promise(resolve => setImmediate(resolve))
        events.push(`end ${label}`)
        inFlight--
        return scopedJob(unit)
      })

      await strategy.handleRequest(pickParams())

      expect(maxInFlight).toBe(1)
      expect(events).toEqual([
        'start 2:*',
        'end 2:*',
        'start 1:3',
        'end 1:3',
        'start 1:4',
        'end 1:4',
      ])
    })

    it('replies once, saying the parts were queued, with the links once', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockMultiSeasonSelection,
      )
      downloadClient.requestShow.mockImplementation(async unit =>
        scopedJob(unit, {
          statusNote:
            unit.seasonNumber === 1
              ? 'Waiting for Sonarr to finish adding the show'
              : undefined,
        }),
      )

      const result = await strategy.handleRequest(pickParams())

      expect(promptService.generateTvShowChatResponse).toHaveBeenCalledTimes(1)
      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_SUCCESS',
        {
          selectedShow: mockShow1,
          requestResults: [
            'season 1: requested and queued (Waiting for Sonarr to finish adding the show)',
            'season 2: requested and queued',
          ],
          autoApplied: false,
          selectionCriteria: undefined,
        },
      ])
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe(
        `Here is your TV show response...\n\n${breakingBadLinks}`,
      )
    })

    it('reports a failed unit alongside the ones that were queued', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1, episodes: [1, 2, 3] }],
      })
      downloadClient.requestShow.mockImplementation(async unit => {
        if (unit.episodeNumber === 2) {
          throw new DownloadApiError(400, 'Bad Request', {
            statusCode: 400,
            message: 'S01E02 is already being downloaded',
            error: 'Bad Request',
          })
        }
        if (unit.episodeNumber === 3) {
          return scopedJob(unit, {
            status: DownloadJobStatus.Failed,
            error: "S01E03 isn't in Sonarr",
          })
        }
        return scopedJob(unit)
      })

      const result = await strategy.handleRequest(pickParams())

      // A failure doesn't stop the units after it
      expect(downloadClient.requestShow).toHaveBeenCalledTimes(3)
      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_SUCCESS',
        expect.objectContaining({
          requestResults: [
            'S01E01: requested and queued',
            "S01E02: couldn't be requested - S01E02 is already being downloaded",
            "S01E03: the request failed - S01E03 isn't in Sonarr",
          ],
        }),
      ])
      expect(result.messages[0].content).toBe(
        `Here is your TV show response...\n\n${breakingBadLinks}`,
      )
    })

    it('says everything is already downloaded when every job comes back completed', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockMultiSeasonSelection,
      )
      downloadClient.requestShow.mockImplementation(async unit =>
        scopedJob(unit, {
          status: DownloadJobStatus.Completed,
          completedAt: '2026-01-01T00:00:00.000Z',
        }),
      )

      const result = await strategy.handleRequest(pickParams())

      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_ALREADY_DOWNLOADED',
        {
          selectedShow: mockShow1,
          requestResults: [
            'season 1: already downloaded',
            'season 2: already downloaded',
          ],
        },
      ])
      expect(result.messages[0].content).toBe(
        `Here is your TV show response...\n\n${breakingBadLinks}`,
      )
    })

    it('goes to the error prompt when no unit was queued, still linking the show', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 0 }, { season: 1 }, { season: 2 }],
      })
      downloadClient.requestShow.mockImplementation(async unit =>
        scopedJob(unit, {
          status:
            unit.seasonNumber === 0
              ? DownloadJobStatus.NotFound
              : unit.seasonNumber === 1
                ? DownloadJobStatus.Completed
                : DownloadJobStatus.Cancelled,
          statusNote:
            unit.seasonNumber === 0 ? 'No release matched' : undefined,
        }),
      )

      const result = await strategy.handleRequest(pickParams())

      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_ERROR',
        {
          selectedShow: mockShow1,
          errorMessage:
            'Requested "Breaking Bad", but nothing was queued: the specials: no release was found (No release matched); season 1: already downloaded; season 2: cancelled before it got anywhere.',
        },
      ])
      expect(result.messages[0].content).toBe(
        `Here is your TV show response...\n\n${breakingBadLinks}`,
      )
    })

    it("hands the download app's error message to the error prompt, with no links", async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      downloadClient.requestShow.mockRejectedValue(
        new DownloadApiError(400, 'Bad Request', {
          statusCode: 400,
          message: 'Sonarr has no "Up to 4K" quality profile',
          error: 'Bad Request',
        }),
      )

      const result = await strategy.handleRequest(
        pickParams({ qualityTier: QualityTier.UpTo4k }),
      )

      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_ERROR',
        {
          selectedShow: mockShow1,
          errorMessage:
            'Couldn\'t request "Breaking Bad": Sonarr has no "Up to 4K" quality profile',
        },
      ])
      // Nothing was created, so there is nothing to link to
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
    })

    it('stops calling once the download app cannot be reached, reporting every unit', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockMultiSeasonSelection,
      )
      downloadClient.requestShow.mockRejectedValue(
        new TypeError('fetch failed'),
      )

      const result = await strategy.handleRequest(pickParams())

      expect(downloadClient.requestShow).toHaveBeenCalledTimes(1)
      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_ERROR',
        {
          selectedShow: mockShow1,
          errorMessage:
            "Couldn't request any of \"Breaking Bad\": season 1: couldn't be requested - the download app might be unavailable (fetch failed); season 2: couldn't be requested - the download app might be unavailable (fetch failed).",
        },
      ])
      expect(result.messages[0]).toBe(mockChatResponse)
    })

    it('requests an auto-applied pick, noting how it was picked', async () => {
      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)

      const result = await strategy.handleRequest(
        pickParams({
          message: new HumanMessage({
            id: '1',
            content: 'breaking 2008 season 1 in hd',
          }),
          context: undefined,
          qualityTier: QualityTier.Hd,
        }),
      )

      expect(downloadClient.requestShow.mock.calls).toEqual([
        [{ tvdbId: 12345, seasonNumber: 1, qualityTier: QualityTier.Hd }],
      ])
      expect(promptService.generateTvShowChatResponse).toHaveBeenCalledTimes(1)
      expect(promptCall()).toEqual([
        [],
        'TV_SHOW_SUCCESS',
        expect.objectContaining({
          autoApplied: true,
          selectionCriteria: 'year: 2008',
        }),
      ])
      expect(result.messages[0].content).toBe(
        `Here is your TV show response...\n\n${breakingBadLinks}`,
      )
    })

    it('keeps the tier asked for with the search through the show and season picks', async () => {
      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])

      const listResult = await strategy.handleRequest(
        pickParams({
          message: new HumanMessage({ id: '1', content: 'breaking in 720p' }),
          context: undefined,
          qualityTier: QualityTier.UpTo720p,
        }),
      )

      expect(listResult.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: expect.objectContaining({ qualityTier: QualityTier.UpTo720p }),
      })
      const listContext = listResult.pendingContext
        ?.data as StrategyRequestParams['context']

      // Show pick - no tier named, so the stored one carries on
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      const showResult = await strategy.handleRequest(
        pickParams({
          message: new HumanMessage({ id: '2', content: 'the first one' }),
          context: listContext,
        }),
      )

      expect(showResult.pendingContext).toEqual({
        type: MediaContextType.TvDownload,
        data: expect.objectContaining({
          searchResults: [mockShow1],
          qualityTier: QualityTier.UpTo720p,
        }),
      })
      const showContext = showResult.pendingContext
        ?.data as StrategyRequestParams['context']

      // Season pick
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      await strategy.handleRequest(
        pickParams({
          message: new HumanMessage({ id: '3', content: 'season 1' }),
          context: showContext,
        }),
      )

      expect(downloadClient.requestShow.mock.calls).toEqual([
        [{ tvdbId: 12345, seasonNumber: 1, qualityTier: QualityTier.UpTo720p }],
      ])
    })

    it('lets a tier named in the pick override the one from the search', async () => {
      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )

      await strategy.handleRequest(
        pickParams({
          message: new HumanMessage({ id: '2', content: 'season 1 in 4k' }),
          qualityTier: QualityTier.UpTo4k,
          context: {
            type: 'tvShow',
            isActive: true,
            searchResults: [mockShow1],
            query: 'breaking bad',
            timestamp: Date.now(),
            qualityTier: QualityTier.UpTo720p,
          },
        }),
      )

      expect(downloadClient.requestShow).toHaveBeenCalledWith({
        tvdbId: 12345,
        seasonNumber: 1,
        qualityTier: QualityTier.UpTo4k,
      })
    })
  })

  // ============================================================================
  // Shared Edge Case Tests
  // ============================================================================
  testStrategyEdgeCases({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedShow,
      },
      mediaService: {
        searchMethod: () => sonarrService.searchShows,
        operationMethod: () => downloadClient.requestShow,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateTvShowChatResponse,
      },
    },
    fixtures: {
      mediaItems: [mockShow1, mockShow2, mockShow3],
      operationResult: mockRequestedJob,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'tv show',
      contextType: 'tvShow',
      serviceName: 'DownloadClient',
      searchMethodName: 'searchShows',
      operationMethodName: 'requestShow',
      errorPromptType: 'TV_SHOW_ERROR',
      processingErrorPromptType: 'TV_SHOW_PROCESSING_ERROR',
    },
  })
})
