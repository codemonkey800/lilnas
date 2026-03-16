import { Module } from '@nestjs/common'

import { RequestHandlingModule } from 'src/media-operations/request-handling/request-handling.module'
import { PromptsModule } from 'src/messages/prompts/prompts.module'
import { ServicesModule } from 'src/services/services.module'
import { StateModule } from 'src/state/state.module'

import { LLMOrchestrationService } from './llm-orchestration.service'
import { ModelFactoryService } from './model-factory.service'
import { DefaultResponseNode } from './nodes/default-response.node'
import { ImageResponseNode } from './nodes/image-response.node'
import { IntentDetectionNode } from './nodes/intent-detection.node'
import { MathResponseNode } from './nodes/math-response.node'
import { MediaResponseNode } from './nodes/media-response.node'

@Module({
  imports: [RequestHandlingModule, StateModule, PromptsModule, ServicesModule],
  providers: [
    LLMOrchestrationService,
    ModelFactoryService,
    IntentDetectionNode,
    DefaultResponseNode,
    ImageResponseNode,
    MathResponseNode,
    MediaResponseNode,
  ],
  exports: [LLMOrchestrationService, ModelFactoryService],
})
export class LLMModule {}
