import { Module } from '@nestjs/common'

import { ServicesModule } from 'src/services/services.module'
import { StateModule } from 'src/state/state.module'

import { GraphHistoryLoggerService } from './graph-history-logger.service'
import { ChatHandler } from './handlers/chat.handler'
import { IMessageHandler, MESSAGE_HANDLERS } from './handlers/handler.interface'
import { HandlerRegistry } from './handlers/handler.registry'
import { KeywordsHandler } from './handlers/keywords.handler'
import { LLMModule } from './llm/llm.module'
import { ModelFactoryModule } from './llm/model-factory.module'
import { MessagesService } from './messages.service'
import { GuardMiddleware } from './middleware/guard.middleware'
import { ResponseService } from './response/response.service'
import { ResponseSanitizer } from './response/response-sanitizer'
import { TypingIndicatorService } from './response/typing-indicator.service'

@Module({
  imports: [LLMModule, ModelFactoryModule, ServicesModule, StateModule],
  providers: [
    MessagesService,
    GuardMiddleware,
    ResponseSanitizer,
    TypingIndicatorService,
    ResponseService,
    GraphHistoryLoggerService,

    KeywordsHandler,
    ChatHandler,
    {
      provide: MESSAGE_HANDLERS,
      useFactory: (
        keywords: KeywordsHandler,
        chat: ChatHandler,
      ): IMessageHandler[] => [keywords, chat],
      inject: [KeywordsHandler, ChatHandler],
    },
    HandlerRegistry,
  ],
})
export class MessagesModule {}
