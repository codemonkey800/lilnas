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

import type {
  TranscriptChannel,
  TranscriptResponse,
  TranscriptTotals,
} from './api.types'
import { toConversationMessages } from './conversation-messages'

const CHANNEL_LIMIT = 50
const CALL_LIMIT = 1000
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
   * The channel's conversation plus its audited LLM calls. Checkpointed
   * messages carry no timestamps, so `from`/`to` (ISO or `YYYY-MM-DD`,
   * inclusive) narrow the calls and totals only.
   */
  @Get(':channelId')
  async getTranscript(
    @Param('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<TranscriptResponse> {
    const range = {
      from: parseDate('from', from, false),
      to: parseDate('to', to, true),
    }
    const [thread, calls] = await Promise.all([
      this.llm.getThreadMessages(channelId),
      this.calls.listByChannel(channelId, { ...range, limit: CALL_LIMIT }),
    ])

    const totals = calls.reduce<TranscriptTotals>(
      (sum, call) => ({
        costUsd: sum.costUsd + Number(call.costUsd ?? 0),
        inputTokens: sum.inputTokens + (call.inputTokens ?? 0),
        outputTokens: sum.outputTokens + (call.outputTokens ?? 0),
      }),
      { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    )

    return { messages: toConversationMessages(thread), calls, totals }
  }
}
