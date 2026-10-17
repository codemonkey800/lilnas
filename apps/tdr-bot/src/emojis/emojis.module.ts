import { Module } from '@nestjs/common'

import { LlmCoreModule } from 'src/llm/llm-core.module'

import { EmojiDescriberService } from './emoji-describer.service'
import { EmojiDictionaryModule } from './emoji-dictionary.module'
import { EmojiEventsService } from './emoji-events.service'
import { EmojiImageService } from './emoji-image.service'
import { EmojiSyncService } from './emoji-sync.service'

/** Keeps `emoji_dictionary` in step with Discord and describes new emojis. */
@Module({
  imports: [EmojiDictionaryModule, LlmCoreModule],
  providers: [
    EmojiDescriberService,
    EmojiEventsService,
    EmojiImageService,
    EmojiSyncService,
  ],
  exports: [EmojiSyncService, EmojiDictionaryModule],
})
export class EmojisModule {}
