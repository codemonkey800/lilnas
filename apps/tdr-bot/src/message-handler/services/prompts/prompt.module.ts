import { Module } from '@nestjs/common'

import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { PromptGenerationService } from './prompt-generation.service'

@Module({
  providers: [
    PromptGenerationService,
    RetryService,
    ErrorClassificationService,
  ],
  exports: [PromptGenerationService],
})
export class PromptModule {}
