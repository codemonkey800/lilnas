import { Module } from '@nestjs/common'

import { EmojiDictionaryModule } from 'src/emojis/emoji-dictionary.module'
import { SettingsModule } from 'src/llm/settings/settings.module'

import { PromptService } from './prompt.service'

@Module({
  imports: [EmojiDictionaryModule, SettingsModule],
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
