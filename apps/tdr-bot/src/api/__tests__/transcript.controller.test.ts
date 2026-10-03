import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'discord.js'

import { TranscriptController } from 'src/api/transcript.controller'
import type { LlmCallRow } from 'src/db/schema'
import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

function call(overrides: Partial<LlmCallRow>): LlmCallRow {
  return {
    id: 'c1',
    requestId: 'r1',
    channelId: 'chan-1',
    userId: null,
    skill: 'chat',
    operation: 'chat.respond',
    model: 'gpt-4.1-mini',
    role: 'chat',
    status: 'ok',
    inputTokens: 100,
    outputTokens: 10,
    cachedTokens: 0,
    costUsd: '0.001000',
    durationMs: 500,
    retries: 0,
    finishReason: 'stop',
    promptHash: null,
    prompt: null,
    output: null,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  }
}

describe('TranscriptController', () => {
  let app: INestApplication
  let base: string
  const getThreadMessages = jest.fn()
  const listByChannel = jest.fn()
  const recentChannels = jest.fn()
  const cache = new Map<string, unknown>()

  beforeEach(async () => {
    jest.resetAllMocks()
    cache.clear()
    const module = await Test.createTestingModule({
      controllers: [TranscriptController],
      providers: [
        { provide: LLMOrchestrationService, useValue: { getThreadMessages } },
        {
          provide: LlmCallsRepository,
          useValue: { listByChannel, recentChannels },
        },
        { provide: Client, useValue: { channels: { cache } } },
      ],
    }).compile()
    app = module.createNestApplication({ logger: false })
    await app.init()
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /transcript/channels', () => {
    it('resolves Discord names and falls back to the id', async () => {
      cache.set('chan-1', { name: 'general' })
      recentChannels.mockResolvedValue([
        {
          channelId: 'chan-1',
          lastAt: new Date('2026-10-02T00:00:00Z'),
          calls: 4,
        },
        {
          channelId: 'chan-2',
          lastAt: new Date('2026-10-01T00:00:00Z'),
          calls: 1,
        },
      ])

      const res = await fetch(`${base}/transcript/channels`)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        {
          channelId: 'chan-1',
          name: 'general',
          lastAt: '2026-10-02T00:00:00.000Z',
          calls: 4,
        },
        {
          channelId: 'chan-2',
          name: 'chan-2',
          lastAt: '2026-10-01T00:00:00.000Z',
          calls: 1,
        },
      ])
    })
  })

  describe('GET /transcript/:channelId', () => {
    it('joins the conversation with calls and sums totals', async () => {
      getThreadMessages.mockResolvedValue([
        new SystemMessage({ id: TDR_SYSTEM_PROMPT_ID, content: 'sys' }),
        new HumanMessage({ id: 'h1', content: 'hello', name: 'mika' }),
        new AIMessage({ id: 'a1', content: 'hi' }),
      ])
      listByChannel.mockResolvedValue([
        call({
          id: 'c2',
          costUsd: '0.002500',
          inputTokens: 50,
          outputTokens: 5,
        }),
        call({ id: 'c1' }),
      ])

      const res = await fetch(`${base}/transcript/chan-1`)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.messages.map((m: { id: string }) => m.id)).toEqual([
        'h1',
        'a1',
      ])
      expect(json.messages[0]).toMatchObject({ type: 'human', name: 'mika' })
      expect(json.calls).toHaveLength(2)
      expect(json.totals).toEqual({
        costUsd: 0.0035,
        inputTokens: 150,
        outputTokens: 15,
      })
    })

    it('passes the date range, treating a date-only `to` as end of day', async () => {
      getThreadMessages.mockResolvedValue([])
      listByChannel.mockResolvedValue([])

      const res = await fetch(
        `${base}/transcript/chan-1?from=2026-09-27&to=2026-10-03`,
      )
      const json = await res.json()

      expect(listByChannel).toHaveBeenCalledWith('chan-1', {
        from: new Date('2026-09-27'),
        to: new Date('2026-10-03T23:59:59.999Z'),
        limit: 1000,
      })
      expect(json).toEqual({
        messages: [],
        calls: [],
        totals: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      })
    })

    it('treats null usage and cost as zero', async () => {
      getThreadMessages.mockResolvedValue([])
      listByChannel.mockResolvedValue([
        call({ costUsd: null, inputTokens: null, outputTokens: null }),
      ])

      const res = await fetch(`${base}/transcript/chan-1`)

      expect((await res.json()).totals).toEqual({
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      })
    })

    it('rejects an invalid date with 400', async () => {
      const res = await fetch(`${base}/transcript/chan-1?from=garbage`)

      expect(res.status).toBe(400)
      expect(listByChannel).not.toHaveBeenCalled()
    })
  })
})
