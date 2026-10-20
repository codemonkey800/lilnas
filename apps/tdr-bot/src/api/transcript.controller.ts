import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common'
import { Client } from 'discord.js'

import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'

import type { TranscriptChannel, TranscriptResponse } from './api.types'
import { toConversationMessages } from './conversation-messages'

const CHANNEL_LIMIT = 50
const PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 200
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function parseDate(
  name: string,
  value: string | undefined,
  endOfDay: boolean,
): Date | undefined {
  if (!value) return undefined
  const date = new Date(
    endOfDay && DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value,
  )
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid "${name}" date: ${value}`)
  }

  return date
}

function parseIndex(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(`Invalid "${name}": ${value}`)
  }

  return Number(value)
}

@Controller('transcript')
export class TranscriptController {
  constructor(
    private readonly llm: LLMOrchestrationService,
    private readonly calls: LlmCallsRepository,
    private readonly client: Client,
  ) {}

  @Get('channels')
  async getChannels(): Promise<TranscriptChannel[]> {
    const recent = await this.calls.recentChannels(CHANNEL_LIMIT)

    return recent.map(({ channelId, lastAt, calls }) => {
      const channel = this.client.channels.cache.get(channelId)
      return {
        channelId,
        name:
          channel && 'name' in channel && channel.name
            ? channel.name
            : channelId,
        lastAt: lastAt.toISOString(),
        calls,
      }
    })
  }

  /**
   * One page of the channel's conversation, newest first, plus the audited
   * LLM calls for the requests on it. `before` is an index into the thread
   * (default: its end) and `limit` the page size; a page is widened back to
   * the turn's human message so it never starts mid-turn. Checkpointed
   * messages carry no timestamps, so `from`/`to` (ISO or `YYYY-MM-DD`,
   * inclusive) scope only the totals, which come with the first page.
   */
  @Get(':channelId')
  async getTranscript(
    @Param('channelId') channelId: string,
    @Query('before') beforeParam?: string,
    @Query('limit') limitParam?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<TranscriptResponse> {
    const range = {
      from: parseDate('from', from, false),
      to: parseDate('to', to, true),
    }
    const requested = parseIndex('before', beforeParam)
    const limit = Math.min(
      MAX_PAGE_LIMIT,
      Math.max(1, parseIndex('limit', limitParam) ?? PAGE_LIMIT),
    )
    const firstPage = requested === undefined

    const [thread, totals] = await Promise.all([
      this.llm.getThreadMessages(channelId),
      firstPage ? this.calls.totalsByChannel(channelId, range) : null,
    ])
    const all = toConversationMessages(thread)
    const before = Math.min(requested ?? all.length, all.length)

    let start = Math.max(0, before - limit)
    while (start > 0 && all[start].type !== 'human') start--

    const messages = all.slice(start, before)
    const requestIds = [
      ...new Set(messages.flatMap(m => (m.requestId ? [m.requestId] : []))),
    ]
    const calls = await this.calls.listByRequestIds(channelId, requestIds)

    return {
      messages,
      calls,
      totals,
      nextCursor: start > 0 ? start : null,
    }
  }
}
