import { Logger, Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { GRAPH_TEST_THREAD_ID } from './llm/graph/thread-id'
import { LLMModule } from './messages/llm/llm.module'
import { LLMOrchestrationService } from './messages/llm/llm-orchestration.service'

@Module({
  imports: [LoggerModule.forRoot(), LLMModule],
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
        channelId: GRAPH_TEST_THREAD_ID,
      })

      console.log('sendMessageV2 response:', { response })
    })
  }
}
