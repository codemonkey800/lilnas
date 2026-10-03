import { Module } from '@nestjs/common'

import { LlmCoreModule } from 'src/llm/llm-core.module'
import { ServicesModule } from 'src/services/services.module'

import { ChatHandler } from './handlers/chat.handler'
import { IMessageHandler, MESSAGE_HANDLERS } from './handlers/handler.interface'
import { HandlerRegistry } from './handlers/handler.registry'
import { KeywordsHandler } from './handlers/keywords.handler'
import { LLMModule } from './llm/llm.module'
import { MessagesService } from './messages.service'
import { GuardMiddleware } from './middleware/guard.middleware'
import { ResponseService } from './response/response.service'
import { ResponseSanitizer } from './response/response-sanitizer'
import { TypingIndicatorService } from './response/typing-indicator.service'

@Module({
  imports: [LLMModule, LlmCoreModule, ServicesModule],
  providers: [
    MessagesService,
    GuardMiddleware,
    ResponseSanitizer,
    TypingIndicatorService,
    ResponseService,

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
