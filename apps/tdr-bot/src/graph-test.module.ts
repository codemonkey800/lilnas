import { Logger, Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { LoggerModule } from 'nestjs-pino'

import { LLMOrchestrationModule } from './message-handler/llm-orchestration.module'
import { LLMOrchestrationService } from './message-handler/llm-orchestration.service'
import { StateModule } from './state/state.module'

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot(),
    StateModule,
    LLMOrchestrationModule,
  ],
  providers: [],
})
export class GraphTestModule {
  private readonly logger = new Logger(LLMOrchestrationService.name)

  constructor(private llmService: LLMOrchestrationService) {}

  test() {
    this.logger.log('Starting graph test')

    process.stdin.on('data', async data => {
      const message = data.toString().trim()

      const response = await this.llmService.sendMessage({
        message,
        user: 'paulbeenis420',
      })

      console.log('sendMessageV2 response:', { response })
    })
  }
}
