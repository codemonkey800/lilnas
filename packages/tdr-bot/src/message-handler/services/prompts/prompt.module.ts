import { Module } from '@nestjs/common'

import { RetryService } from 'src/utils/retry.service'

import { PromptGenerationService } from './prompt-generation.service'

@Module({
  providers: [PromptGenerationService, RetryService],
  exports: [PromptGenerationService],
})
export class PromptModule {}
