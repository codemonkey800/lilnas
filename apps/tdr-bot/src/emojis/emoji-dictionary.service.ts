import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { EmojiRow } from 'src/db/schema'
import { EmojiResolution, resolveEmojis } from 'src/emojis/emoji-analysis'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'
import { emojiKey } from 'src/emojis/emoji-key'
import { formatEmojiDictionary } from 'src/utils/prompts'

type DescribedRow = EmojiRow & { description: string }

function isDescribed(row: EmojiRow): row is DescribedRow {
  return row.description !== null
}

/** Snowflake order; ids are numeric strings, so compare them as BigInts. */
function bySnowflake(a: EmojiRow, b: EmojiRow): number {
  const x = BigInt(a.id)
  const y = BigInt(b.id)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * In-memory cache of the live, described emojis and the prompt section built
 * from them. The prompt shows only shortcodes (':name:'); the canonical
 * tokens stay here so {@link resolve} can turn the model's shortcodes back
 * into them. Prompts read {@link promptText} synchronously; callers that
 * change the table call {@link refresh}.
 */
@Injectable()
export class EmojiDictionaryService implements OnModuleInit {
  private readonly logger = new Logger(EmojiDictionaryService.name)
  private entries: Record<string, string> = {}
  private tokens: readonly string[] = []
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

  /**
   * Reloads listActiveDescribed() and rebuilds the prompt text. Rows without a
   * description are skipped; when several rows share an exact name the newest
   * snowflake wins, so each shortcode maps to one token. Names that differ
   * only in case are distinct rows and both stay.
   */
  async refresh(): Promise<void> {
    const rows = await this.repo.listActiveDescribed()
    const newest = new Map<string, DescribedRow>()
    for (const row of rows) {
      if (!isDescribed(row)) continue
      const current = newest.get(row.name)
      if (current === undefined || bySnowflake(current, row) < 0) {
        newest.set(row.name, row)
      }
    }
    const chosen = [...newest.values()].sort(bySnowflake)
    const entries: Record<string, string> = {}
    for (const row of chosen) {
      entries[`:${row.name}:`] = row.description
    }
    this.entries = entries
    this.tokens = chosen.map(emojiKey)
    this.text = formatEmojiDictionary(entries)
    this.logger.log(
      { count: rows.length, names: chosen.length },
      'Emoji dictionary loaded',
    )
  }

  /** formatEmojiDictionary of { ':name:': description }, rows sorted by BigInt(id) ascending. */
  promptText(): string {
    return this.text
  }

  /** The canonical tokens for the names the prompt shows, in prompt order. */
  keys(): readonly string[] {
    return this.tokens
  }

  /** Number of chosen rows; always equals keys().length. */
  size(): number {
    return this.tokens.length
  }

  /** resolveEmojis(text, keys()): shortcodes and tokens against the cached dictionary. */
  resolve(text: string): EmojiResolution {
    return resolveEmojis(text, this.tokens)
  }
}
