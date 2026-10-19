import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { EmojiRow } from 'src/db/schema'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'
import { emojiKey } from 'src/emojis/emoji-key'
import { formatEmojiDictionary } from 'src/utils/prompts'

/** Snowflake order; ids are numeric strings, so compare them as BigInts. */
function bySnowflake(a: EmojiRow, b: EmojiRow): number {
  const x = BigInt(a.id)
  const y = BigInt(b.id)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * In-memory cache of the live, described emojis and the prompt section built
 * from them. Prompts read {@link promptText} synchronously; callers that
 * change the table call {@link refresh}.
 */
@Injectable()
export class EmojiDictionaryService implements OnModuleInit {
  private readonly logger = new Logger(EmojiDictionaryService.name)
  private entries: Record<string, string> = {}
  private text = formatEmojiDictionary({})

  constructor(private readonly repo: EmojiDictionaryRepository) {}

  /** Loads the cache; logs and keeps the empty cache on a DB error, never throws. */
  async onModuleInit(): Promise<void> {
    try {
      await this.refresh()
    } catch (err) {
      this.logger.error({ err }, 'Failed to load emoji dictionary')
    }
  }

  /** Reloads listActiveDescribed() and rebuilds the prompt text. */
  async refresh(): Promise<void> {
    const rows = await this.repo.listActiveDescribed()
    const entries: Record<string, string> = {}
    for (const row of [...rows].sort(bySnowflake)) {
      if (row.description === null) continue
      entries[emojiKey(row)] = row.description
    }
    this.entries = entries
    this.text = formatEmojiDictionary(entries)
    this.logger.log({ count: rows.length }, 'Emoji dictionary loaded')
  }

  /** formatEmojiDictionary of { [emojiKey(row)]: description }, rows sorted by BigInt(id) ascending. */
  promptText(): string {
    return this.text
  }

  /** The cached keys in prompt order: exactly what the model was shown. */
  keys(): readonly string[] {
    return Object.keys(this.entries)
  }

  size(): number {
    return Object.keys(this.entries).length
  }
}
