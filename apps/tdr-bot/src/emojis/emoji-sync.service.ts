import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Mutex } from 'async-mutex'
import { Client, type GuildEmoji } from 'discord.js'

import { EmojiRow } from 'src/db/schema'
import {
  EMOJI_BATCH_SIZE,
  EMOJI_DESCRIBE_CONCURRENCY,
  EMOJI_EXAMPLE_COUNT,
} from 'src/emojis/emoji.constants'
import {
  DescribeResult,
  EmojiDescriberService,
  EmojiExample,
} from 'src/emojis/emoji-describer.service'
import {
  EmojiDictionaryRepository,
  EmojiMeta,
} from 'src/emojis/emoji-dictionary.repository'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'

export type ReconcileTrigger =
  'boot' | 'cron' | 'admin' | 'event' | 'redescribe-all'

export interface ReconcileSummary {
  trigger: ReconcileTrigger
  /** Emojis upserted in phase 1 (0 for a re-describe-all run). */
  synced: number
  softDeleted: number
  /** Filled (or, for a re-describe-all run, rewritten) by the LLM. */
  described: number
  failed: number
  durationMs: number
  /** ISO timestamp. */
  finishedAt: string
}

export interface ReconcileStatus {
  running: boolean
  last: ReconcileSummary | null
}

export class EmojiNotFoundError extends Error {
  constructor(id: string) {
    super(`Emoji ${id} not found`)
    this.name = 'EmojiNotFoundError'
  }
}

export class EmojiDeletedError extends Error {
  constructor(id: string) {
    super(`Emoji ${id} is deleted`)
    this.name = 'EmojiDeletedError'
  }
}

interface DescribeCounts {
  described: number
  failed: number
}

/** Runs `work` over `items` with at most `limit` calls in flight. `work` must not throw. */
async function runPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function toExample(row: EmojiRow): EmojiExample | null {
  if (row.description === null) return null
  return {
    name: row.name,
    animated: row.animated,
    description: row.description,
  }
}

/**
 * Keeps `emoji_dictionary` in step with Discord. Phase 1 mirrors the guilds'
 * emojis into the table; phase 2 fills missing descriptions, first from the
 * old static dictionary, then with the LLM. Every write path runs under one
 * mutex so they never interleave.
 */
@Injectable()
export class EmojiSyncService {
  private readonly logger = new Logger(EmojiSyncService.name)
  private readonly mutex = new Mutex()
  private current: Promise<ReconcileSummary> | null = null
  private last: ReconcileSummary | null = null

  constructor(
    private readonly client: Client,
    private readonly repo: EmojiDictionaryRepository,
    private readonly describer: EmojiDescriberService,
    private readonly dictionary: EmojiDictionaryService,
  ) {}

  /**
   * Both phases under the mutex. A call while a reconcile is running
   * returns that run's promise instead of starting another.
   */
  reconcile(trigger: ReconcileTrigger): Promise<ReconcileSummary> {
    return this.start(() => this.runReconcile(trigger))
  }

  /**
   * Rewrites every live description with the LLM, hand-written ones
   * included, a batch of emojis per call. Shares the one-run-at-a-time
   * guard with `reconcile`.
   */
  redescribeAll(): Promise<ReconcileSummary> {
    return this.start(() => this.runRedescribeAll())
  }

  private start(
    work: () => Promise<ReconcileSummary>,
  ): Promise<ReconcileSummary> {
    if (this.current) return this.current
    const run = this.mutex.runExclusive(work).finally(() => {
      this.current = null
    })
    this.current = run
    return run
  }

  /** emojiCreate / emojiUpdate: upsert this emoji, then phase 2, under the mutex. */
  async syncEmoji(emoji: GuildEmoji): Promise<void> {
    const { name } = emoji
    if (name === null) {
      this.logger.warn({ emojiId: emoji.id }, 'Skipping emoji without a name')
      return
    }
    await this.mutex.runExclusive(async () => {
      await this.repo.upsertMeta([
        {
          id: emoji.id,
          guildId: emoji.guild.id,
          name,
          animated: emoji.animated ?? false,
        },
      ])
      const counts = await this.describePending()
      this.logger.log({ emojiId: emoji.id, name, ...counts }, 'emoji.sync')
    })
  }

  /** emojiDelete: soft-delete, refresh the dictionary, under the mutex. */
  async removeEmoji(id: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await this.repo.softDelete(id)
      await this.dictionary.refresh()
      this.logger.log({ emojiId: id }, 'emoji.remove')
    })
  }

  /**
   * Describe one emoji now with the LLM and overwrite its description
   * (source 'ai'), even a manual one.
   */
  async redescribe(id: string): Promise<EmojiRow> {
    const row = await this.repo.get(id)
    if (!row) throw new EmojiNotFoundError(id)
    if (row.deletedAt) throw new EmojiDeletedError(id)

    const examples = await this.loadExamples()
    const result = await this.describer.describe(
      { id: row.id, name: row.name, animated: row.animated },
      examples,
    )
    const updated = await this.repo.setDescription(id, {
      description: result.description,
      source: 'ai',
      model: result.model,
    })
    if (!updated) throw new EmojiNotFoundError(id)
    await this.dictionary.refresh()
    return updated
  }

  status(): ReconcileStatus {
    return { running: this.current !== null, last: this.last }
  }

  private finish(
    trigger: ReconcileTrigger,
    startedAt: number,
    counts: Omit<ReconcileSummary, 'trigger' | 'durationMs' | 'finishedAt'>,
  ): ReconcileSummary {
    const summary = {
      trigger,
      ...counts,
      durationMs: Date.now() - startedAt,
      finishedAt: new Date().toISOString(),
    }
    this.last = summary
    return summary
  }

  private async runReconcile(
    trigger: ReconcileTrigger,
  ): Promise<ReconcileSummary> {
    const startedAt = Date.now()

    if (!this.client.isReady()) {
      this.logger.warn(
        { trigger },
        'Discord client not ready; skipping reconcile',
      )
      return this.finish(trigger, startedAt, {
        synced: 0,
        softDeleted: 0,
        described: 0,
        failed: 0,
      })
    }

    const { synced, softDeleted } = await this.syncAll()
    const counts = await this.describePending()
    const summary = this.finish(trigger, startedAt, {
      synced,
      softDeleted,
      ...counts,
    })
    this.logger.log({ ...summary }, 'emoji.reconcile')
    return summary
  }

  private async runRedescribeAll(): Promise<ReconcileSummary> {
    const startedAt = Date.now()
    const rows = (await this.repo.listAll()).filter(row => !row.deletedAt)
    // Snapshot the style examples first: the run overwrites the
    // descriptions they come from.
    const examples = await this.loadExamples()
    let described = 0
    let failed = 0

    await runPool(
      chunk(rows, EMOJI_BATCH_SIZE),
      EMOJI_DESCRIBE_CONCURRENCY,
      async batch => {
        const results = await this.describeBatchWithFallback(batch, examples)
        for (const row of batch) {
          const result = results.get(row.id)
          if (!result) {
            failed++
            continue
          }
          try {
            const updated = await this.repo.setDescription(row.id, {
              description: result.description,
              source: 'ai',
              model: result.model,
            })
            if (updated) described++
          } catch (err) {
            failed++
            this.logger.warn(
              { emojiId: row.id, name: row.name, error: getErrorMessage(err) },
              'Failed to save re-described emoji',
            )
          }
        }
      },
    )

    await this.dictionary.refresh()
    const summary = this.finish('redescribe-all', startedAt, {
      synced: 0,
      softDeleted: 0,
      described,
      failed,
    })
    this.logger.log({ ...summary }, 'emoji.redescribe-all')
    return summary
  }

  /**
   * One batched call; any emoji it fails to cover (a skipped entry, or the
   * whole call erroring on e.g. one dead image URL) is retried on its own,
   * so a single bad emoji can't sink the batch. Never throws.
   */
  private async describeBatchWithFallback(
    batch: EmojiRow[],
    examples: EmojiExample[],
  ): Promise<Map<string, DescribeResult>> {
    const input = batch.map(row => ({
      id: row.id,
      name: row.name,
      animated: row.animated,
    }))

    let results = new Map<string, DescribeResult>()
    try {
      results = await this.describer.describeBatch(input, examples)
    } catch (err) {
      this.logger.warn(
        { size: batch.length, error: getErrorMessage(err) },
        'Batched emoji describe failed; retrying one by one',
      )
    }

    for (const emoji of input) {
      if (results.has(emoji.id)) continue
      try {
        results.set(emoji.id, await this.describer.describe(emoji, examples))
      } catch (err) {
        this.logger.warn(
          { emojiId: emoji.id, name: emoji.name, error: getErrorMessage(err) },
          'Failed to describe emoji',
        )
      }
    }
    return results
  }

  /** Phase 1: mirror every available guild's emojis into the table. */
  private async syncAll(): Promise<{ synced: number; softDeleted: number }> {
    const all: EmojiMeta[] = []
    const skipGuildIds: string[] = []
    for (const guild of this.client.guilds.cache.values()) {
      if (!guild.available) {
        skipGuildIds.push(guild.id)
        continue
      }
      for (const emoji of guild.emojis.cache.values()) {
        if (emoji.name === null) continue
        all.push({
          id: emoji.id,
          guildId: guild.id,
          name: emoji.name,
          animated: emoji.animated ?? false,
        })
      }
    }

    await this.repo.upsertMeta(all)
    const softDeleted = await this.repo.softDeleteMissing(
      all.map(emoji => emoji.id),
      skipGuildIds,
    )
    await this.dictionary.refresh()
    return { synced: all.length, softDeleted }
  }

  /** Phase 2: fill missing descriptions with the LLM. */
  private async describePending(): Promise<DescribeCounts> {
    const counts: DescribeCounts = { described: 0, failed: 0 }
    const rows = await this.repo.listUndescribed()

    if (rows.length > 0) {
      const examples = await this.loadExamples()
      await runPool(rows, EMOJI_DESCRIBE_CONCURRENCY, async row => {
        try {
          const result = await this.describer.describe(
            { id: row.id, name: row.name, animated: row.animated },
            examples,
          )
          const filled = await this.repo.fillDescription(row.id, {
            description: result.description,
            source: 'ai',
            model: result.model,
          })
          if (filled) counts.described++
        } catch (err) {
          counts.failed++
          this.logger.warn(
            { emojiId: row.id, name: row.name, error: getErrorMessage(err) },
            'Failed to describe emoji',
          )
        }
      })
    }

    await this.dictionary.refresh()
    return counts
  }

  private async loadExamples(): Promise<EmojiExample[]> {
    const rows = await this.repo.listExamples(EMOJI_EXAMPLE_COUNT)
    return rows.flatMap(row => toExample(row) ?? [])
  }
}
