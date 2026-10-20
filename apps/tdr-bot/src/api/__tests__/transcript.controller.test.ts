import {
  AIMessage,
  BaseMessage,
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

/** System prompt plus `turns` human/AI pairs: h0, a0 (request r0), h1, ... */
function thread(turns: number): BaseMessage[] {
  return [
    new SystemMessage({ id: TDR_SYSTEM_PROMPT_ID, content: 'sys' }),
    ...Array.from({ length: turns }, (_, i) => [
      new HumanMessage({ id: `h${i}`, content: `q${i}`, name: 'mika' }),
      new AIMessage({
        id: `a${i}`,
        content: `a${i}`,
        additional_kwargs: { requestId: `r${i}` },
      }),
    ]).flat(),
  ]
}

const ids = (json: { messages: { id: string }[] }) =>
  json.messages.map(m => m.id)

const ZERO_TOTALS = { costUsd: 0, inputTokens: 0, outputTokens: 0 }

describe('TranscriptController', () => {
  let app: INestApplication
  let base: string
  const getThreadMessages = jest.fn()
  const listByRequestIds = jest.fn()
  const totalsByChannel = jest.fn()
  const recentChannels = jest.fn()
  const cache = new Map<string, unknown>()

  beforeEach(async () => {
    jest.resetAllMocks()
    cache.clear()
    listByRequestIds.mockResolvedValue([])
    totalsByChannel.mockResolvedValue(ZERO_TOTALS)
    const module = await Test.createTestingModule({
      controllers: [TranscriptController],
      providers: [
        { provide: LLMOrchestrationService, useValue: { getThreadMessages } },
        {
          provide: LlmCallsRepository,
          useValue: { listByRequestIds, totalsByChannel, recentChannels },
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
    const get = async (query = '') => {
      const res = await fetch(`${base}/transcript/chan-1${query}`)
      return { status: res.status, json: await res.json() }
    }

    it('returns the last 50 messages with the page calls and totals', async () => {
      getThreadMessages.mockResolvedValue(thread(60))
      const calls = [call({ id: 'c1', requestId: 'r59' })]
      listByRequestIds.mockResolvedValue(calls)
      totalsByChannel.mockResolvedValue({
        costUsd: 0.0035,
        inputTokens: 150,
        outputTokens: 15,
      })

      const { status, json } = await get()

      expect(status).toBe(200)
      expect(json.messages).toHaveLength(50)
      expect(ids(json)[0]).toBe('h35')
      expect(ids(json).at(-1)).toBe('a59')
      expect(json.messages[0]).toMatchObject({ type: 'human', name: 'mika' })
      expect(json.nextCursor).toBe(70)
      expect(json.calls).toHaveLength(1)
      expect(json.totals).toEqual({
        costUsd: 0.0035,
        inputTokens: 150,
        outputTokens: 15,
      })
    })

    it('slices [before - limit, before)', async () => {
      getThreadMessages.mockResolvedValue(thread(6))

      const { json } = await get('?before=10&limit=4')

      expect(ids(json)).toEqual(['h3', 'a3', 'h4', 'a4'])
      expect(json.nextCursor).toBe(6)
    })

    it("moves the page start back to the turn's human message", async () => {
      getThreadMessages.mockResolvedValue(thread(6))

      const { json } = await get('?limit=3')

      expect(ids(json)).toEqual(['h4', 'a4', 'h5', 'a5'])
      expect(json.nextCursor).toBe(8)
    })

    it('starts at 0 when no earlier human message exists', async () => {
      getThreadMessages.mockResolvedValue([
        new AIMessage({ id: 'a0', content: 'greeting' }),
        new AIMessage({ id: 'a1', content: 'again' }),
      ])

      const { json } = await get('?limit=1')

      expect(ids(json)).toEqual(['a0', 'a1'])
      expect(json.nextCursor).toBeNull()
    })

    it('returns a null cursor at the start of the thread', async () => {
      getThreadMessages.mockResolvedValue(thread(3))

      const { json } = await get('?before=4')

      expect(ids(json)).toEqual(['h0', 'a0', 'h1', 'a1'])
      expect(json.nextCursor).toBeNull()
    })

    it('clamps `before` to the thread length', async () => {
      getThreadMessages.mockResolvedValue(thread(1))

      const { json } = await get('?before=99')

      expect(ids(json)).toEqual(['h0', 'a0'])
    })

    it("requests calls for the page's request ids only", async () => {
      getThreadMessages.mockResolvedValue([
        ...thread(3),
        new HumanMessage({ id: 'h3', content: 'legacy' }),
        new AIMessage({ id: 'a3', content: 'no request id' }),
      ])

      await get('?before=6&limit=4')

      expect(listByRequestIds).toHaveBeenCalledWith('chan-1', ['r1', 'r2'])
    })

    it('sends totals for the date range on the first page only', async () => {
      getThreadMessages.mockResolvedValue(thread(3))

      const first = await get('?from=2026-09-27&to=2026-10-03')
      expect(totalsByChannel).toHaveBeenCalledWith('chan-1', {
        from: new Date('2026-09-27'),
        to: new Date('2026-10-03T23:59:59.999Z'),
      })
      expect(first.json.totals).toEqual(ZERO_TOTALS)

      totalsByChannel.mockClear()
      const older = await get('?before=2&from=2026-09-27')
      expect(totalsByChannel).not.toHaveBeenCalled()
      expect(older.json.totals).toBeNull()
    })

    it('returns an empty page for an empty thread', async () => {
      getThreadMessages.mockResolvedValue([])

      const { json } = await get()

      expect(json).toEqual({
        messages: [],
        calls: [],
        totals: ZERO_TOTALS,
        nextCursor: null,
      })
    })

    it.each([
      '?from=garbage',
      '?before=abc',
      '?before=-1',
      '?limit=1.5',
      '?limit=',
    ])('rejects %s with 400', async query => {
      const { status } = await get(query)

      expect(status).toBe(400)
      expect(getThreadMessages).not.toHaveBeenCalled()
    })
  })
})
