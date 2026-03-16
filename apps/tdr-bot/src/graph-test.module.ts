import { Logger, Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { LLMModule } from './messages/llm/llm.module'
import { LLMOrchestrationService } from './messages/llm/llm-orchestration.service'
import { StateModule } from './state/state.module'

@Module({
  imports: [LoggerModule.forRoot(), StateModule, LLMModule],
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
