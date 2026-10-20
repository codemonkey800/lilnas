import { Injectable } from '@nestjs/common'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  max,
  SQL,
  sql,
} from 'drizzle-orm'

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

export interface ChannelTotals {
  costUsd: number
  inputTokens: number
  outputTokens: number
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

  /** A channel's calls for the given requests, oldest first. */
  async listByRequestIds(
    channelId: string,
    requestIds: string[],
  ): Promise<LlmCallRow[]> {
    if (requestIds.length === 0) return []
    return this.drizzle.db
      .select()
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.channelId, channelId),
          inArray(llmCalls.requestId, requestIds),
        ),
      )
      .orderBy(asc(llmCalls.createdAt))
  }

  /** Summed usage and cost of a channel's calls within the range. */
  async totalsByChannel(
    channelId: string,
    range: LlmCallsRange,
  ): Promise<ChannelTotals> {
    const [row] = await this.drizzle.db
      .select({
        inputTokens: sql<string>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
        costUsd: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)`,
      })
      .from(llmCalls)
      .where(and(eq(llmCalls.channelId, channelId), ...rangeConditions(range)))
    return {
      costUsd: Number(row?.costUsd ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
    }
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
