import { Module } from '@nestjs/common'

import { EmojisModule } from 'src/emojis/emojis.module'
import { LlmCoreModule } from 'src/llm/llm-core.module'
import { LLMModule } from 'src/messages/llm/llm.module'
import { RemindersModule } from 'src/reminders/reminders.module'
import { ServicesModule } from 'src/services/services.module'

import { ApiController } from './api.controller'
import { EmojisController } from './emojis.controller'
import { RemindersController } from './reminders.controller'
import { TranscriptController } from './transcript.controller'

@Module({
  controllers: [
    ApiController,
    EmojisController,
    RemindersController,
    TranscriptController,
  ],
  imports: [
    EmojisModule,
    LlmCoreModule,
    LLMModule,
    RemindersModule,
    ServicesModule,
  ],
})
export class ApiModule {}
