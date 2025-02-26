import { Logger, Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { LoggerModule } from 'nestjs-pino'

import { LLMService } from './message-handler/llm.service'
import { StateModule } from './state/state.module'

@Module({
  imports: [EventEmitterModule.forRoot(), LoggerModule.forRoot(), StateModule],
  providers: [LLMService],
})
export class GraphTestModule {
  private readonly logger = new Logger(LLMService.name)

  constructor(private llmService: LLMService) {}

  test() {
    this.logger.log('Starting graph test')

    process.stdin.on('data', async (data) => {
      const message = data.toString().trim()

      const response = await this.llmService.sendMessage({
        message,
        user: 'paulbeenis420',
      })

      console.log('sendMessageV2 response:', { response })
    })
  }
}
