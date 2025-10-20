import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'
import { ServicesModule } from 'src/services/services.module'
import { StateModule } from 'src/state/state.module'

import { ChatService } from './chat.service'
import { GraphHistoryLoggerService } from './graph-history-logger.service'
import { KeywordsService } from './keywords.service'
import { LLMOrchestrationModule } from './llm-orchestration.module'
import { MessageHandlerService } from './message-handler.service'
import { MessageLoggerService } from './message-logger.service'

@Module({
  imports: [MediaModule, ServicesModule, StateModule, LLMOrchestrationModule],
  providers: [
    ChatService,
    KeywordsService,
    MessageHandlerService,
    MessageLoggerService,
    GraphHistoryLoggerService,
  ],
})
export class MessageHandlerModule {}
