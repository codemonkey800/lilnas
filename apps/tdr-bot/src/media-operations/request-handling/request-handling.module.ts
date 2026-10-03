import { Module } from '@nestjs/common'

import { LlmCoreModule } from 'src/llm/llm-core.module'
import { PromptModule } from 'src/llm/skills/media/prompt.module'
import { MediaModule } from 'src/media/media.module'

import { DownloadClientFactory } from './download-client.factory'
import { MediaRequestHandler } from './media-request-handler.service'
import { DownloadStatusStrategy } from './strategies/download-status.strategy'
import { MediaBrowsingStrategy } from './strategies/media-browsing.strategy'
import { MovieDeleteStrategy } from './strategies/movie-delete.strategy'
import { MovieDownloadStrategy } from './strategies/movie-download.strategy'
import { TvDeleteStrategy } from './strategies/tv-delete.strategy'
import { TvDownloadStrategy } from './strategies/tv-download.strategy'
import { DataFetchingUtilities } from './utils/data-fetching.utils'
import { ParsingUtilities } from './utils/parsing.utils'
import { SelectionUtilities } from './utils/selection.utils'
import { ValidationUtilities } from './utils/validation.utils'

/**
 * RequestHandlingModule - Phase 5 Integration
 *
 * Provides the MediaRequestHandler service and all its dependencies:
 * - 6 strategy classes for different media operations
 * - 4 utility classes for parsing, selection, validation, and data fetching
 * - DownloadClientFactory, for strategies that call the download app as the
 *   requesting Discord user
 * - Integration with existing modules (Prompt, Media, LlmCore)
 *
 * Note: FormattingUtilities exports functions, not a class, so it's not included as a provider
 */
@Module({
  imports: [
    PromptModule, // For PromptGenerationService
    MediaModule, // For RadarrService, SonarrService
    LlmCoreModule, // For LlmClient
  ],
  providers: [
    // Utility classes (4 utilities - formatting exports functions, not a class)
    ParsingUtilities,
    SelectionUtilities,
    ValidationUtilities,
    DataFetchingUtilities,

    // Download app client, stamped with the requesting Discord user
    DownloadClientFactory,

    // Strategy classes (6 strategies)
    MovieDownloadStrategy,
    TvDownloadStrategy,
    MovieDeleteStrategy,
    TvDeleteStrategy,
    MediaBrowsingStrategy,
    DownloadStatusStrategy,

    // Main request handler
    MediaRequestHandler,
  ],
  exports: [
    MediaRequestHandler, // Export for use in other modules (Phase 6)
    DownloadClientFactory,
  ],
})
export class RequestHandlingModule {}
