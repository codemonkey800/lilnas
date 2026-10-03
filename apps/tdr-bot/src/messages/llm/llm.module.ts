import { Module } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'
import {
  graphCheckpointerProvider,
  GraphCheckpointerSetup,
} from 'src/llm/graph/checkpointer'
import { LlmCoreModule } from 'src/llm/llm-core.module'
import { SkillsModule } from 'src/llm/skills/skills.module'
import { PromptsModule } from 'src/messages/prompts/prompts.module'
import { ServicesModule } from 'src/services/services.module'

import { LLMOrchestrationService } from './llm-orchestration.service'

/** Provides the orchestration service that runs the skills graph. */
@Module({
  imports: [
    DrizzleModule,
    LlmCoreModule,
    PromptsModule,
    ServicesModule,
    SkillsModule,
  ],
  providers: [
    graphCheckpointerProvider,
    GraphCheckpointerSetup,
    LLMOrchestrationService,
  ],
  exports: [LLMOrchestrationService],
})
export class LLMModule {}
