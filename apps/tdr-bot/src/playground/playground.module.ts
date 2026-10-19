import { Module } from '@nestjs/common'

import { EmojiDictionaryModule } from 'src/emojis/emoji-dictionary.module'
import { LlmCoreModule } from 'src/llm/llm-core.module'
import { PromptsModule } from 'src/messages/prompts/prompts.module'

import { PlaygroundService } from './playground.service'

/** Deliberately never imports LLMModule, the graph or the checkpointer. */
@Module({
  imports: [LlmCoreModule, PromptsModule, EmojiDictionaryModule],
  providers: [PlaygroundService],
  exports: [PlaygroundService],
})
export class PlaygroundModule {}
