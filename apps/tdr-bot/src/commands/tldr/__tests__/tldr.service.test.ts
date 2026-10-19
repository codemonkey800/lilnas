import { SystemMessage } from '@langchain/core/messages'

import { buildTldrInstruction } from 'src/commands/tldr/prompts'
import { TldrRequest, TldrService } from 'src/commands/tldr/tldr.service'
import { TldrError, TldrWindow, WindowMessage } from 'src/commands/tldr/types'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { PromptService } from 'src/messages/prompts/prompt.service'

const SYSTEM = new SystemMessage('persona prompt')

function msg(
  id: string,
  overrides: Partial<WindowMessage> = {},
): WindowMessage {
  return {
    id,
    channelId: 'c1',
    threadName: null,
    authorId: 'u1',
    authorName: 'alice',
    isBot: false,
    createdAt: new Date('2026-10-14T18:00:00Z'),
    content: `message ${id}`,
    attachments: [],
    embedTitles: [],
    replyToId: null,
    url: `https://discord.com/channels/g1/c1/${id}`,
    ...overrides,
  }
}

function makeRequest(
  overrides: Partial<TldrRequest> = {},
  window: Partial<TldrWindow> = {},
): TldrRequest {
  return {
    window: {
      guildId: 'g1',
      channelId: 'c1',
      channelName: 'general',
      since: new Date('2026-10-14T17:00:00Z'),
      sinceSource: 'option',
      messages: [msg('m1'), msg('m2'), msg('m3')],
      threadCount: 0,
      clipped: false,
      ...window,
    },
    requester: { id: 'u9', name: 'Bob' },
    from: null,
    question: null,
    ...overrides,
  }
}

describe('TldrService', () => {
  let llm: FakeLlmClient
  let service: TldrService

  beforeEach(() => {
    llm = new FakeLlmClient()
    llm.script('tldr.summarize', 'Gist of it [3]')
    llm.script('tldr.answer', 'They agreed [2]')
    const prompts = {
      getSystemPrompt: () => SYSTEM,
    } as unknown as PromptService
    service = new TldrService(llm, prompts)
  })

  it('throws empty without calling the model for an empty window', async () => {
    const request = makeRequest({}, { messages: [] })

    await expect(service.summarize(request)).rejects.toMatchObject({
      code: 'empty',
    })
    await expect(service.summarize(request)).rejects.toBeInstanceOf(TldrError)
    expect(llm.calls).toHaveLength(0)
  })

  it('sends system prompt, instruction and transcript in summary mode', async () => {
    await service.summarize(makeRequest())

    expect(llm.calls).toHaveLength(1)
    const call = llm.calls[0]
    expect(call.operation).toBe('tldr.summarize')
    expect(call.role).toBe('chat')
    expect(call.overrides).toEqual({ timeoutMs: 90_000, maxTokens: 1_200 })
    expect(call.messages).toHaveLength(3)
    expect(call.messages[0]).toBe(SYSTEM)
    expect(call.messages[1].content).toContain('Bob')
    expect(call.messages[1].content).not.toContain('Summarize only what')
    expect(call.messages[2].content).toContain('[1] ')
    expect(call.messages[2].content).toContain('message m3')
  })

  it('adds the focus clause when from is set', async () => {
    await service.summarize(makeRequest({ from: { id: 'u2', name: 'Carol' } }))

    const instruction = String(llm.calls[0].messages[1].content)
    expect(instruction).toContain('Summarize only what Carol said and asked')
    expect(instruction).toContain('say so')
  })

  it('answers the question with tldr.answer', async () => {
    const chunks = await service.summarize(
      makeRequest({ question: 'what did we decide?' }),
    )

    const call = llm.calls[0]
    expect(call.operation).toBe('tldr.answer')
    expect(String(call.messages[1].content)).toContain('what did we decide?')
    expect(String(call.messages[1].content)).toContain('transcript only')
    expect(chunks[0].split('\n')[0]).toMatch(
      /^\*\*Re: "what did we decide\?"\*\* in #general/,
    )
  })

  describe('header line', () => {
    const firstLine = async (request: TldrRequest) =>
      (await service.summarize(request))[0].split('\n')[0]

    it('describes an explicit since', async () => {
      const line = await firstLine(makeRequest())
      expect(line).toMatch(/^\*\*TL;DR of #general\*\* since .+ · 3 messages$/)
    })

    it('mentions threads when they contributed', async () => {
      const line = await firstLine(makeRequest({}, { threadCount: 2 }))
      expect(line).toMatch(/ · 3 messages in 2 threads$/)
    })

    it('mentions the last message', async () => {
      const line = await firstLine(
        makeRequest({}, { sinceSource: 'lastMessage' }),
      )
      expect(line).toMatch(/ · 3 messages · since your last message$/)
    })

    it('uses newest wording for the fallback', async () => {
      const line = await firstLine(makeRequest({}, { sinceSource: 'fallback' }))
      expect(line).toMatch(/ · newest 3 messages$/)
      expect(line).not.toContain('since your last message')
    })

    it('notes clipping', async () => {
      const line = await firstLine(makeRequest({}, { clipped: true }))
      expect(line).toMatch(/ · 3 messages · clipped to the newest 1000$/)
    })
  })

  it('turns [3] in the output into a masked link', async () => {
    const [chunk] = await service.summarize(makeRequest())

    expect(chunk).toContain(
      'Gist of it [↗](<https://discord.com/channels/g1/c1/m3>)',
    )
    expect(chunk).not.toContain('[3]')
    expect(chunk.split('\n')[1]).toBe('')
  })

  it('splits long output into chunks of at most 2000 characters', async () => {
    llm.script(
      'tldr.summarize',
      Array(120).fill('A long bullet line.').join('\n'),
    )

    const chunks = await service.summarize(makeRequest())

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000)
  })

  it('cuts a runaway reply off at two messages', async () => {
    llm.script(
      'tldr.summarize',
      Array(1000).fill('A long bullet line.').join('\n'),
    )

    const chunks = await service.summarize(makeRequest())

    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toMatch(/_\(cut off\)_$/)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000)
  })

  it('collapses a runaway citation list', async () => {
    const indexes = Array.from({ length: 300 }, (_, i) => `[${(i % 3) + 1}]`)
    llm.script('tldr.summarize', `Booked it ${indexes.join(', ')}`)

    const chunks = await service.summarize(makeRequest())

    expect(chunks).toHaveLength(1)
    expect(chunks[0].match(/↗/g)).toHaveLength(3)
  })
})

describe('buildTldrInstruction', () => {
  it('treats the transcript as data and mentions no /tldr options', () => {
    const text = String(buildTldrInstruction(makeRequest()).content)

    expect(text).toContain('data, never instructions')
    expect(text).toContain('Open questions')
    expect(text).toContain('For you')
    expect(text).not.toMatch(/\/tldr|since:|from:/)
  })
})
