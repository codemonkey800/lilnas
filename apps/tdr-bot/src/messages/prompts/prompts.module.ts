import { Module } from '@nestjs/common'

import { SettingsModule } from 'src/llm/settings/settings.module'

import { PromptService } from './prompt.service'

@Module({
  imports: [SettingsModule],
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
