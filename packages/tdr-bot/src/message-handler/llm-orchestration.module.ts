import { Module } from '@nestjs/common'

import { RequestHandlingModule } from 'src/media-operations/request-handling/request-handling.module'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateModule } from 'src/state/state.module'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { LLMOrchestrationService } from './llm-orchestration.service'

/**
 * LLMOrchestrationModule
 *
 * Provides the lightweight LLMOrchestrationService with all required dependencies.
 *
 * Dependencies:
 * - RequestHandlingModule: Provides MediaRequestHandler (includes all Phase 1-5 services)
 * - StateModule: Provides StateService for graph history management
 * - EquationImageService: LaTeX rendering for math responses
 * - RetryService: API retry logic with exponential backoff
 * - ErrorClassificationService: Error handling and classification
 *
 * This module can coexist with the original LLMService during migration.
 */
@Module({
  imports: [
    RequestHandlingModule, // Phase 5 ✅ (includes Context, Prompt, Media services)
    StateModule, // Existing state management
  ],
  providers: [
    LLMOrchestrationService,
    EquationImageService,
    RetryService,
    ErrorClassificationService,
  ],
  exports: [LLMOrchestrationService],
})
export class LLMOrchestrationModule {}
