import type { DownloadClient } from '@lilnas/utils/download/client'

import { LlmClient } from 'src/llm/client/llm-client'
import { PromptGenerationService } from 'src/llm/skills/media/prompt-generation.service'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import { DiscordIdentity } from 'src/media-operations/request-handling/types/request-context.type'
import { DataFetchingUtilities } from 'src/media-operations/request-handling/utils/data-fetching.utils'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ValidationUtilities } from 'src/media-operations/request-handling/utils/validation.utils'
import { RetryService } from 'src/utils/retry.service'

// ============================================================================
// Request Params
// ============================================================================

/**
 * The Discord identity every `StrategyRequestParams` carries, keyed to the
 * test's `userId` so the two describe the same sender.
 */
export function createMockDiscordIdentity(userId = 'user123'): DiscordIdentity {
  return {
    userId,
    username: 'testuser',
    displayName: 'Test User',
  }
}

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
    unmonitorAndDeleteMovie: jest.fn(),
  } as unknown as jest.Mocked<RadarrService>
}

/**
 * A `DownloadClientFactory` whose `forDiscord` always hands back the same
 * mocked client, so a test can stub `client.requestMovie`/`requestShow` and
 * then assert both what was requested and who `forDiscord` was called for.
 */
export function createMockDownloadClientFactory(): {
  factory: jest.Mocked<DownloadClientFactory>
  client: jest.Mocked<DownloadClient>
} {
  const client = {
    requestMovie: jest.fn(),
    requestShow: jest.fn(),
  } as unknown as jest.Mocked<DownloadClient>

  const factory = {
    forDiscord: jest.fn().mockReturnValue(client),
  } as unknown as jest.Mocked<DownloadClientFactory>

  return { factory, client }
}

export function createMockSonarrService(): jest.Mocked<SonarrService> {
  return {
    searchShows: jest.fn(),
    getLibrarySeries: jest.fn(),
    getSystemStatus: jest.fn(),
    checkHealth: jest.fn(),
    getDownloadingEpisodes: jest.fn(),
    unmonitorAndDeleteSeries: jest.fn(),
    getSeriesDetails: jest.fn(),
    getSeasonDetails: jest.fn(),
    getEpisodeDetails: jest.fn(),
  } as unknown as jest.Mocked<SonarrService>
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

/** A scriptable `LlmClient`; script per operation, e.g. `'media.intent'`. */
export function createFakeLlmClient(): FakeLlmClient {
  return new FakeLlmClient()
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
  return {
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<ParsingUtilities['logger']>,
    llm: createFakeLlmClient(),
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
  retry?: jest.Mocked<RetryService>
  llm?: FakeLlmClient
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
  if (services.includes('retry')) mocks.retry = createMockRetryService()
  if (services.includes('llm')) mocks.llm = createFakeLlmClient()
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
  if (mocks.retry) {
    providers.push({ provide: RetryService, useValue: mocks.retry })
  }
  if (mocks.llm) {
    providers.push({ provide: LlmClient, useValue: mocks.llm })
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
