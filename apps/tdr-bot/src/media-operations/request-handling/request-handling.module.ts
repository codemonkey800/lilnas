import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'
import { ContextModule } from 'src/message-handler/context/context.module'
import { PromptModule } from 'src/message-handler/services/prompts/prompt.module'
import { StateModule } from 'src/state/state.module'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

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
 * - Integration with existing modules (Context, Prompt, Media, State)
 *
 * Note: FormattingUtilities exports functions, not a class, so it's not included as a provider
 */
@Module({
  imports: [
    ContextModule, // For ContextManagementService
    PromptModule, // For PromptGenerationService
    MediaModule, // For RadarrService, SonarrService
    StateModule, // For StateService (used by utilities)
  ],
  providers: [
    // Core error classification and retry services
    ErrorClassificationService,
    RetryService,

    // Utility classes (4 utilities - formatting exports functions, not a class)
    ParsingUtilities,
    SelectionUtilities,
    ValidationUtilities,
    DataFetchingUtilities,

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
  ],
})
export class RequestHandlingModule {}
