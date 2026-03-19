import { Module } from '@nestjs/common'

import { RequestHandlingModule } from 'src/media-operations/request-handling/request-handling.module'
import { ContextModule } from 'src/message-handler/context/context.module'
import { PromptsModule } from 'src/messages/prompts/prompts.module'
import { RemindersModule } from 'src/reminders/reminders.module'
import { ServicesModule } from 'src/services/services.module'

import { LLMOrchestrationService } from './llm-orchestration.service'
import { ModelFactoryModule } from './model-factory.module'
import { DefaultResponseNode } from './nodes/default-response.node'
import { ImageResponseNode } from './nodes/image-response.node'
import { IntentDetectionNode } from './nodes/intent-detection.node'
import { MathResponseNode } from './nodes/math-response.node'
import { MediaResponseNode } from './nodes/media-response.node'
import { ReminderResponseNode } from './nodes/reminder-response.node'

/**
 * Aggregates all LLM graph nodes and the orchestration service.
 *
 * Imports the reminder, media, context, and model-factory modules
 * so every node has access to its required dependencies.
 */
@Module({
  imports: [
    RequestHandlingModule,
    ModelFactoryModule,
    PromptsModule,
    ServicesModule,
    RemindersModule,
    ContextModule,
  ],
  providers: [
    LLMOrchestrationService,
    IntentDetectionNode,
    DefaultResponseNode,
    ImageResponseNode,
    MathResponseNode,
    MediaResponseNode,
    ReminderResponseNode,
  ],
  exports: [LLMOrchestrationService],
})
export class LLMModule {}
