import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, gte, lte, max, SQL, sql } from 'drizzle-orm'

import { DrizzleService } from 'src/db/drizzle.service'
import { LlmCallRow, llmCalls, NewLlmCallRow } from 'src/db/schema'

export interface LlmCallsRange {
  from?: Date
  to?: Date
}

export interface LlmCallsTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
}

export interface RecentChannel {
  channelId: string
  lastAt: Date
  calls: number
}

function rangeConditions(range: LlmCallsRange): SQL[] {
  const conditions: SQL[] = []
  if (range.from) conditions.push(gte(llmCalls.createdAt, range.from))
  if (range.to) conditions.push(lte(llmCalls.createdAt, range.to))
  return conditions
}

/** Reads and writes the `llm_calls` audit table. */
@Injectable()
export class LlmCallsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(row: NewLlmCallRow): Promise<void> {
    await this.drizzle.db.insert(llmCalls).values(row)
  }

  /** Newest first. */
  async listByChannel(
    channelId: string,
    opts: LlmCallsRange & { limit: number },
  ): Promise<LlmCallRow[]> {
    return this.drizzle.db
      .select()
      .from(llmCalls)
      .where(and(eq(llmCalls.channelId, channelId), ...rangeConditions(opts)))
      .orderBy(desc(llmCalls.createdAt))
      .limit(opts.limit)
  }

  async totals(range: { from: Date; to: Date }): Promise<LlmCallsTotals> {
    const [row] = await this.drizzle.db
      .select({
        calls: count(),
        inputTokens: sql<string>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
        cachedTokens: sql<string>`coalesce(sum(${llmCalls.cachedTokens}), 0)`,
        costUsd: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)`,
      })
      .from(llmCalls)
      .where(and(...rangeConditions(range)))
    return {
      calls: Number(row?.calls ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      cachedTokens: Number(row?.cachedTokens ?? 0),
      costUsd: Number(row?.costUsd ?? 0),
    }
  }

  /** Channels with the most recent calls first. */
  async recentChannels(limit: number): Promise<RecentChannel[]> {
    const lastAt = max(llmCalls.createdAt)
    const rows = await this.drizzle.db
      .select({
        channelId: llmCalls.channelId,
        lastAt: lastAt.mapWith(llmCalls.createdAt),
        calls: count(),
      })
      .from(llmCalls)
      .where(sql`${llmCalls.channelId} is not null`)
      .groupBy(llmCalls.channelId)
      .orderBy(desc(lastAt))
      .limit(limit)
    return rows.flatMap(r =>
      r.channelId && r.lastAt
        ? [{ channelId: r.channelId, lastAt: r.lastAt, calls: r.calls }]
        : [],
    )
  }
}
