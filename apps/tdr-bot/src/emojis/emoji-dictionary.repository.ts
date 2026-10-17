import { Injectable } from '@nestjs/common'
import { and, asc, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'

import { DrizzleService } from 'src/db/drizzle.service'
import { emojiDictionary, EmojiRow, EmojiSource } from 'src/db/schema'

/** Discord-side facts about an emoji; refreshed on every sync. */
export interface EmojiMeta {
  id: string
  guildId: string
  name: string
  animated: boolean
}

/** What a description write sets, manual or AI. */
export interface EmojiDescription {
  description: string
  source: EmojiSource
  model: string | null
}

/** Drizzle access to the `emoji_dictionary` table; business rules live in the service. */
@Injectable()
export class EmojiDictionaryRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Inserts new emojis and refreshes the Discord metadata of known ones,
   * reviving soft-deleted rows. Never touches the description columns.
   */
  async upsertMeta(rows: EmojiMeta[]): Promise<void> {
    if (rows.length === 0) return
    await this.drizzle.db
      .insert(emojiDictionary)
      .values(rows)
      .onConflictDoUpdate({
        target: emojiDictionary.id,
        set: {
          guildId: sql`excluded.guild_id`,
          name: sql`excluded.name`,
          animated: sql`excluded.animated`,
          deletedAt: null,
          updatedAt: sql`now()`,
        },
      })
  }

  /**
   * Soft-deletes live rows whose id is not in `keepIds`, leaving rows of the
   * `skipGuildIds` guilds alone. An empty `keepIds` deletes every live row
   * outside the skipped guilds. Returns the count.
   */
  async softDeleteMissing(
    keepIds: string[],
    skipGuildIds: string[],
  ): Promise<number> {
    const deleted = await this.drizzle.db
      .update(emojiDictionary)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          isNull(emojiDictionary.deletedAt),
          keepIds.length ? notInArray(emojiDictionary.id, keepIds) : undefined,
          skipGuildIds.length
            ? notInArray(emojiDictionary.guildId, skipGuildIds)
            : undefined,
        ),
      )
      .returning({ id: emojiDictionary.id })
    return deleted.length
  }

  /** Soft-deletes one row unless it is already deleted. */
  async softDelete(id: string): Promise<void> {
    await this.drizzle.db
      .update(emojiDictionary)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(emojiDictionary.id, id), isNull(emojiDictionary.deletedAt)))
  }

  /** Live rows still waiting for a description. */
  async listUndescribed(): Promise<EmojiRow[]> {
    return this.drizzle.db
      .select()
      .from(emojiDictionary)
      .where(
        and(
          isNull(emojiDictionary.description),
          isNull(emojiDictionary.deletedAt),
        ),
      )
      .orderBy(asc(emojiDictionary.id))
  }

  /** Live described rows: the set the prompt's dictionary is built from. */
  async listActiveDescribed(): Promise<EmojiRow[]> {
    return this.drizzle.db
      .select()
      .from(emojiDictionary)
      .where(
        and(
          isNotNull(emojiDictionary.description),
          isNull(emojiDictionary.deletedAt),
        ),
      )
      .orderBy(asc(emojiDictionary.id))
  }

  /** Every row, deleted ones included, for the admin page. */
  async listAll(): Promise<EmojiRow[]> {
    return this.drizzle.db
      .select()
      .from(emojiDictionary)
      .orderBy(asc(emojiDictionary.id))
  }

  async get(id: string): Promise<EmojiRow | undefined> {
    const [found] = await this.drizzle.db
      .select()
      .from(emojiDictionary)
      .where(eq(emojiDictionary.id, id))
    return found
  }

  /**
   * Live described rows, used as style examples for the model. Hand-written
   * descriptions come first, then the rest by id.
   */
  async listExamples(limit: number): Promise<EmojiRow[]> {
    return this.drizzle.db
      .select()
      .from(emojiDictionary)
      .where(
        and(
          isNotNull(emojiDictionary.description),
          isNull(emojiDictionary.deletedAt),
        ),
      )
      .orderBy(
        sql`(${emojiDictionary.source} = 'manual') desc`,
        asc(emojiDictionary.id),
      )
      .limit(limit)
  }

  /**
   * Sets the description only while the row has none, so a sync never
   * clobbers an edit. True when a row changed.
   */
  async fillDescription(id: string, value: EmojiDescription): Promise<boolean> {
    const updated = await this.drizzle.db
      .update(emojiDictionary)
      .set(this.descriptionSet(value))
      .where(
        and(eq(emojiDictionary.id, id), isNull(emojiDictionary.description)),
      )
      .returning({ id: emojiDictionary.id })
    return updated.length > 0
  }

  /** Sets the description unconditionally. Undefined when the id is unknown. */
  async setDescription(
    id: string,
    value: EmojiDescription,
  ): Promise<EmojiRow | undefined> {
    const [updated] = await this.drizzle.db
      .update(emojiDictionary)
      .set(this.descriptionSet(value))
      .where(eq(emojiDictionary.id, id))
      .returning()
    return updated
  }

  private descriptionSet(value: EmojiDescription) {
    return {
      description: value.description,
      source: value.source,
      model: value.model,
      describedAt: sql`now()`,
      updatedAt: sql`now()`,
    }
  }
}
