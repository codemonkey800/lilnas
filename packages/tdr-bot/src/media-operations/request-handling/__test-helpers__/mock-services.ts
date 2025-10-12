import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { DataFetchingUtilities } from 'src/media-operations/request-handling/utils/data-fetching.utils'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ValidationUtilities } from 'src/media-operations/request-handling/utils/validation.utils'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { StateService } from 'src/state/state.service'
import { RetryService } from 'src/utils/retry.service'

// ============================================================================
// Individual Mock Creators
// ============================================================================

export function createMockRadarrService(): jest.Mocked<RadarrService> {
  return {
    searchMovies: jest.fn(),
    getSystemStatus: jest.fn(),
    checkHealth: jest.fn(),
    getLibraryMovies: jest.fn(),
    getDownloadingMovies: jest.fn(),
    monitorAndDownloadMovie: jest.fn(),
    unmonitorAndDeleteMovie: jest.fn(),
  } as unknown as jest.Mocked<RadarrService>
}

export function createMockSonarrService(): jest.Mocked<SonarrService> {
  return {
    searchShows: jest.fn(),
    getLibrarySeries: jest.fn(),
    getSystemStatus: jest.fn(),
    checkHealth: jest.fn(),
    getDownloadingEpisodes: jest.fn(),
    monitorAndDownloadSeries: jest.fn(),
    unmonitorAndDeleteSeries: jest.fn(),
    getSeriesDetails: jest.fn(),
    getSeasonDetails: jest.fn(),
    getEpisodeDetails: jest.fn(),
  } as unknown as jest.Mocked<SonarrService>
}

export function createMockStateService(
  stateOverrides?: Record<string, unknown>,
): jest.Mocked<StateService> {
  return {
    setState: jest.fn(),
    getState: jest.fn().mockReturnValue({
      reasoningModel: 'gpt-4o-mini',
      chatModel: 'gpt-4',
      temperature: 0.7,
      graphHistory: [],
      maxTokens: 4096,
      prompt: '',
      userMovieContexts: new Map(),
      userMovieDeleteContexts: new Map(),
      userTvShowContexts: new Map(),
      userTvShowDeleteContexts: new Map(),
      ...stateOverrides,
    }),
    getPrompt: jest.fn(),
    setUserMovieContext: jest.fn(),
    clearUserMovieContext: jest.fn(),
    getUserMovieContext: jest.fn(),
    isMovieContextExpired: jest.fn(),
    cleanupExpiredMovieContexts: jest.fn(),
    setUserTvShowContext: jest.fn(),
    clearUserTvShowContext: jest.fn(),
    getUserTvShowContext: jest.fn(),
    isTvShowContextExpired: jest.fn(),
    cleanupExpiredTvShowContexts: jest.fn(),
    setUserMovieDeleteContext: jest.fn(),
    clearUserMovieDeleteContext: jest.fn(),
    getUserMovieDeleteContext: jest.fn(),
    isMovieDeleteContextExpired: jest.fn(),
    cleanupExpiredMovieDeleteContexts: jest.fn(),
    setUserTvShowDeleteContext: jest.fn(),
    clearUserTvShowDeleteContext: jest.fn(),
    getUserTvShowDeleteContext: jest.fn(),
    isTvShowDeleteContextExpired: jest.fn(),
    cleanupExpiredTvShowDeleteContexts: jest.fn(),
  } as unknown as jest.Mocked<StateService>
}

export function createMockRetryService(): jest.Mocked<RetryService> {
  return {
    executeWithRetry: jest.fn().mockImplementation(async fn => await fn()),
    executeWithCircuitBreaker: jest
      .fn()
      .mockImplementation(async fn => await fn()),
    resetCircuitBreaker: jest.fn(),
    getCircuitBreakerStatus: jest.fn(),
  } as unknown as jest.Mocked<RetryService>
}

export function createMockPromptGenerationService(): jest.Mocked<PromptGenerationService> {
  return {
    generateMoviePrompt: jest.fn(),
    generateMovieDeletePrompt: jest.fn(),
    generateTvShowPrompt: jest.fn(),
    generateMediaContextPrompt: jest.fn(),
    generateTvShowDeletePrompt: jest.fn(),
    generateTvShowChatResponse: jest.fn(),
    generateTvShowDeleteChatResponse: jest.fn(),
  } as unknown as jest.Mocked<PromptGenerationService>
}

export function createMockParsingUtilities(): jest.Mocked<ParsingUtilities> {
  const mockState = createMockStateService()
  const mockRetry = createMockRetryService()

  return {
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ParsingUtilities['logger']>,
    state: mockState,
    retryService: mockRetry,
    getReasoningModel: jest.fn(),
    parseInitialSelection: jest.fn(),
    parseSearchSelection: jest.fn(),
    parseTvShowSelection: jest.fn(),
    extractSearchQueryWithLLM: jest.fn(),
    extractTvDeleteQueryWithLLM: jest.fn(),
  } as unknown as jest.Mocked<ParsingUtilities>
}

export function createMockSelectionUtilities(): jest.Mocked<SelectionUtilities> {
  return {
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<SelectionUtilities['logger']>,
    findSelectedMovie: jest.fn(),
    findSelectedMovieFromLibrary: jest.fn(),
    findSelectedShow: jest.fn(),
    findSelectedTvShowFromLibrary: jest.fn(),
  } as unknown as jest.Mocked<SelectionUtilities>
}

export function createMockDataFetchingUtilities(): jest.Mocked<DataFetchingUtilities> {
  const mockRadarr = createMockRadarrService()
  const mockSonarr = createMockSonarrService()

  return {
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<DataFetchingUtilities['logger']>,
    radarrService: mockRadarr,
    sonarrService: mockSonarr,
    fetchLibraryData: jest.fn(),
    fetchExternalSearchData: jest.fn(),
  } as unknown as jest.Mocked<DataFetchingUtilities>
}

export function createMockValidationUtilities(): jest.Mocked<ValidationUtilities> {
  return {
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ValidationUtilities['logger']>,
    validateDownloadResponse: jest.fn(),
  } as unknown as jest.Mocked<ValidationUtilities>
}

// ============================================================================
// Bundled Mock Providers
// ============================================================================

export interface StrategyTestMocks {
  radarr?: jest.Mocked<RadarrService>
  sonarr?: jest.Mocked<SonarrService>
  state?: jest.Mocked<StateService>
  retry?: jest.Mocked<RetryService>
  promptGeneration?: jest.Mocked<PromptGenerationService>
  parsing?: jest.Mocked<ParsingUtilities>
  selection?: jest.Mocked<SelectionUtilities>
  dataFetching?: jest.Mocked<DataFetchingUtilities>
  validation?: jest.Mocked<ValidationUtilities>
}

/**
 * Creates a set of mocked services for strategy tests
 * @param services - Array of service names to create mocks for
 * @returns Object with mocked services
 */
export function createStrategyMocks(
  services: Array<keyof StrategyTestMocks>,
): StrategyTestMocks {
  const mocks: StrategyTestMocks = {}

  if (services.includes('radarr')) mocks.radarr = createMockRadarrService()
  if (services.includes('sonarr')) mocks.sonarr = createMockSonarrService()
  if (services.includes('state')) mocks.state = createMockStateService()
  if (services.includes('retry')) mocks.retry = createMockRetryService()
  if (services.includes('promptGeneration'))
    mocks.promptGeneration = createMockPromptGenerationService()
  if (services.includes('parsing')) mocks.parsing = createMockParsingUtilities()
  if (services.includes('selection'))
    mocks.selection = createMockSelectionUtilities()
  if (services.includes('dataFetching'))
    mocks.dataFetching = createMockDataFetchingUtilities()
  if (services.includes('validation'))
    mocks.validation = createMockValidationUtilities()

  return mocks
}

/**
 * Creates NestJS test providers from mocked services
 * Useful for TestingModule.createTestingModule()
 */
export function createMockProviders(mocks: StrategyTestMocks) {
  const providers: Array<{ provide: unknown; useValue: unknown }> = []

  if (mocks.radarr) {
    providers.push({ provide: RadarrService, useValue: mocks.radarr })
  }
  if (mocks.sonarr) {
    providers.push({ provide: SonarrService, useValue: mocks.sonarr })
  }
  if (mocks.state) {
    providers.push({ provide: StateService, useValue: mocks.state })
  }
  if (mocks.retry) {
    providers.push({ provide: RetryService, useValue: mocks.retry })
  }
  if (mocks.promptGeneration) {
    providers.push({
      provide: PromptGenerationService,
      useValue: mocks.promptGeneration,
    })
  }
  if (mocks.parsing) {
    providers.push({ provide: ParsingUtilities, useValue: mocks.parsing })
  }
  if (mocks.selection) {
    providers.push({ provide: SelectionUtilities, useValue: mocks.selection })
  }
  if (mocks.dataFetching) {
    providers.push({
      provide: DataFetchingUtilities,
      useValue: mocks.dataFetching,
    })
  }
  if (mocks.validation) {
    providers.push({
      provide: ValidationUtilities,
      useValue: mocks.validation,
    })
  }

  return providers
}
