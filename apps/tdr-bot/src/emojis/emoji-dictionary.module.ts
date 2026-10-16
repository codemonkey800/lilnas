import { Module } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'

import { EmojiDictionaryRepository } from './emoji-dictionary.repository'
import { EmojiDictionaryService } from './emoji-dictionary.service'

/** The `emoji_dictionary` repository and the prompt cache built on it. */
@Module({
  imports: [DrizzleModule],
  providers: [EmojiDictionaryRepository, EmojiDictionaryService],
  exports: [EmojiDictionaryRepository, EmojiDictionaryService],
})
export class EmojiDictionaryModule {}
