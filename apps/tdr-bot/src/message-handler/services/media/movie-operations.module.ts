import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'
import { ContextModule } from 'src/message-handler/context/context.module'
import { PromptModule } from 'src/message-handler/services/prompts/prompt.module'
import { StateModule } from 'src/state/state.module'
import { RetryService } from 'src/utils/retry.service'

import { MovieOperationsService } from './movie-operations.service'

/**
 * Module providing movie operations functionality.
 * Integrates with context management, prompt generation, and media services.
 */
@Module({
  imports: [
    ContextModule, // For ContextManagementService
    PromptModule, // For PromptGenerationService
    MediaModule, // For RadarrService
    StateModule, // For StateService (temporary for model access)
  ],
  providers: [MovieOperationsService, RetryService],
  exports: [MovieOperationsService],
})
export class MovieOperationsModule {}
