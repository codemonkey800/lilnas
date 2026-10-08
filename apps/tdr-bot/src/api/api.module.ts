import { Module } from '@nestjs/common'

import { LlmCoreModule } from 'src/llm/llm-core.module'
import { LLMModule } from 'src/messages/llm/llm.module'
import { RemindersModule } from 'src/reminders/reminders.module'
import { ServicesModule } from 'src/services/services.module'

import { ApiController } from './api.controller'
import { RemindersController } from './reminders.controller'
import { TranscriptController } from './transcript.controller'

@Module({
  controllers: [ApiController, RemindersController, TranscriptController],
  imports: [LlmCoreModule, LLMModule, RemindersModule, ServicesModule],
})
export class ApiModule {}
