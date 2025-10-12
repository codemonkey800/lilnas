import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'
import { ContextModule } from 'src/message-handler/context/context.module'
import { PromptModule } from 'src/message-handler/services/prompts/prompt.module'
import { StateModule } from 'src/state/state.module'
import { RetryService } from 'src/utils/retry.service'

import { TvOperationsService } from './tv-operations.service'

/**
 * Module providing TV show operations functionality.
 * Integrates with context management, prompt generation, and media services.
 */
@Module({
  imports: [
    ContextModule, // For ContextManagementService
    PromptModule, // For PromptGenerationService
    MediaModule, // For SonarrService
    StateModule, // For StateService (temporary for model access)
  ],
  providers: [TvOperationsService, RetryService],
  exports: [TvOperationsService],
})
export class TvOperationsModule {}
