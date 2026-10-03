import { Module } from '@nestjs/common'

import { LlmCoreModule } from 'src/llm/llm-core.module'

import { PromptGenerationService } from './prompt-generation.service'

@Module({
  imports: [LlmCoreModule],
  providers: [PromptGenerationService],
  exports: [PromptGenerationService],
})
export class PromptModule {}
