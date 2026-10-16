import type { EmojiRow } from 'src/db/schema'
import { emojiKey } from 'src/emojis/emoji-key'

import type { EmojiView } from './api.types'

const iso = (date: Date | null): string | null => date?.toISOString() ?? null

/** Discord's CDN URL for an emoji image. */
export function emojiImageUrl(row: { id: string; animated: boolean }): string {
  return `https://cdn.discordapp.com/emojis/${row.id}.${row.animated ? 'gif' : 'png'}`
}

/** Maps an `emoji_dictionary` row to its API shape. */
export function toEmojiView(row: EmojiRow): EmojiView {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    animated: row.animated,
    key: emojiKey(row),
    imageUrl: emojiImageUrl(row),
    description: row.description,
    source: row.source,
    model: row.model,
    describedAt: iso(row.describedAt),
    deletedAt: iso(row.deletedAt),
    updatedAt: row.updatedAt.toISOString(),
  }
}
