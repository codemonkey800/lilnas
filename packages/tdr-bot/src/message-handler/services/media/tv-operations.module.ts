import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'
import { ContextManagementModule } from 'src/message-handler/context/context-management.module'
import { PromptGenerationModule } from 'src/message-handler/services/prompts/prompt-generation.module'
import { StateModule } from 'src/state/state.module'
import { RetryModule } from 'src/utils/retry.module'

import { TvOperationsService } from './tv-operations.service'

/**
 * Module providing TV show operations functionality
 */
@Module({
  imports: [
    MediaModule, // For SonarrService
    ContextManagementModule,
    PromptGenerationModule,
    RetryModule,
    StateModule,
  ],
  providers: [TvOperationsService],
  exports: [TvOperationsService],
})
export class TvOperationsModule {}
