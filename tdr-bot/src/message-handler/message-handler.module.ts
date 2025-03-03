import { Module } from '@nestjs/common'

import { ServicesModule } from 'src/services/services.module'
import { StateModule } from 'src/state/state.module'

import { ChatService } from './chat.service'
import { KeywordsService } from './keywords.service'
import { LLMService } from './llm.service'
import { MessageHandlerService } from './message-handler.service'

@Module({
  imports: [ServicesModule, StateModule],
  providers: [ChatService, KeywordsService, LLMService, MessageHandlerService],
})
export class MessageHandlerModule {}
