import { Module } from '@nestjs/common'

import { StateModule } from 'src/state/state.module'

import { PromptService } from './prompt.service'

@Module({
  imports: [StateModule],
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
