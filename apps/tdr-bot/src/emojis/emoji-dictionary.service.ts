import { AIMessage, BaseMessage } from '@langchain/core/messages'
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

/** The name inside a canonical token: '<a:name:id>' → 'name'. */
const TOKEN_NAME_RE = /^<a?:([A-Za-z0-9_]{2,32}):\d+>$/

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
  private shortcodeNames: readonly string[] = []
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
    this.shortcodeNames = chosen.map(row => row.name)
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

  /** The shortcode names the prompt shows, without colons, in prompt order. */
  names(): readonly string[] {
    return this.shortcodeNames
  }

  /**
   * Dictionary emoji names used in the last `replies` AI messages, most recent
   * first and without duplicates. Unknown or dropped refs are skipped.
   */
  recentlyUsed(messages: readonly BaseMessage[], replies = 5): string[] {
    const recent = messages
      .filter(message => AIMessage.isInstance(message))
      .slice(-replies)
      .reverse()
    const names = new Set<string>()
    for (const message of recent) {
      for (const emoji of this.resolve(message.text).emojis) {
        const name = emoji.key?.match(TOKEN_NAME_RE)?.[1]
        if (name) names.add(name)
      }
    }
    return [...names]
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
