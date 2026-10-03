import { Module } from '@nestjs/common'

import { LlmCoreModule } from 'src/llm/llm-core.module'
import { LLMModule } from 'src/messages/llm/llm.module'
import { ServicesModule } from 'src/services/services.module'

import { ApiController } from './api.controller'
import { TranscriptController } from './transcript.controller'

@Module({
  controllers: [ApiController, TranscriptController],
  imports: [LlmCoreModule, LLMModule, ServicesModule],
})
export class ApiModule {}
