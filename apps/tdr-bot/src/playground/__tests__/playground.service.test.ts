import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'

import { createTestingModule } from 'src/__tests__/test-utils'
import { resolveEmojis } from 'src/emojis/emoji-analysis'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { LlmClient } from 'src/llm/client/llm-client'
import { ModelRegistry } from 'src/llm/models/model-registry'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { PromptService } from 'src/messages/prompts/prompt.service'
import {
  PlaygroundModelError,
  PlaygroundService,
} from 'src/playground/playground.service'
import { INPUT_FORMAT, PERSONA_REMINDER, PROMPT_INTRO } from 'src/utils/prompts'

const SAVED_PROMPT = 'Be a helpful kawaii assistant.'
const DICTIONARY_TEXT =
  'FAKE EMOJI DICTIONARY {"<:EZ:758414734805696553>":"smug"}'
const KEYS = ['<:EZ:758414734805696553>', '<a:pog:758414734805696554>']
const CHAT_MODEL = 'gpt-6-luna'
// A dictionary shortcode, a wrong-ID token, an unknown shortcode and unicode.
const RAW_REPLY = 'hi :EZ: <a:pog:758414734805696599> :fake: 😀'
// The unknown shortcode is dropped along with its surrounding whitespace.
const RESOLVED_REPLY =
  'hi <:EZ:758414734805696553> <a:pog:758414734805696554> 😀'

describe('PlaygroundService', () => {
  let service: PlaygroundService
  let llm: FakeLlmClient
  let registry: { isAllowedFor: jest.Mock }
  // Empty by default so no style note is added; set before chat() to get one.
  let names: string[]

  beforeEach(async () => {
    names = []
    llm = new FakeLlmClient().script('playground.chat', RAW_REPLY)
    registry = {
      isAllowedFor: jest.fn(
        (id: string, role: string) => id === CHAT_MODEL && role === 'chat',
      ),
    }

    const module = await createTestingModule([
      PlaygroundService,
      PromptService,
      { provide: LlmClient, useValue: llm },
      { provide: ModelRegistry, useValue: registry },
      {
        provide: SettingsService,
        useValue: {
          get: () => ({ ...defaultSettings(), systemPrompt: SAVED_PROMPT }),
        },
      },
      {
        provide: EmojiDictionaryService,
        useValue: {
          promptText: () => DICTIONARY_TEXT,
          keys: () => KEYS,
          size: () => KEYS.length,
          resolve: (text: string) => resolveEmojis(text, KEYS),
          names: () => names,
          recentlyUsed: () => [],
        },
      },
    ])

    service = module.get(PlaygroundService)
  })

  const chat = (overrides = {}) =>
    service.chat({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: 'hello' }],
      ...overrides,
    })

  const systemContent = () => {
    const [system] = llm.calls[0].messages
    expect(system).toBeInstanceOf(SystemMessage)
    return system.content as string
  }

  it('builds the system message from the saved prompt by default', async () => {
    await chat()

    const content = systemContent()
    expect(content.startsWith(PROMPT_INTRO.trim())).toBe(true)
    expect(content).toContain(INPUT_FORMAT.trim())
    expect(content).toContain(SAVED_PROMPT)
    expect(content).toContain(DICTIONARY_TEXT)
    expect(content.endsWith(PERSONA_REMINDER.trim())).toBe(true)
  })

  it('uses the draft instead of the saved prompt when given', async () => {
    await chat({ systemPromptDraft: '  Draft prompt.  ' })

    const content = systemContent()
    expect(content.startsWith(PROMPT_INTRO.trim())).toBe(true)
    expect(content).toContain('Draft prompt.')
    expect(content).not.toContain(SAVED_PROMPT)
    expect(content).toContain(DICTIONARY_TEXT)
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   \n '],
  ])(
    'falls back to the saved prompt for a %s draft',
    async (_, systemPromptDraft) => {
      await chat({ systemPromptDraft })

      expect(systemContent()).toContain(SAVED_PROMPT)
    },
  )

  it('maps history to Human/AI messages with the author name', async () => {
    await chat({
      author: 'Some One',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ],
    })

    const [, ...history] = llm.calls[0].messages
    expect(history).toHaveLength(3)
    expect(history[0]).toBeInstanceOf(HumanMessage)
    expect(history[0].content).toBe('first')
    expect(history[0].name).toBe('Some_One')
    expect(history[1]).toBeInstanceOf(AIMessage)
    expect(history[1].content).toBe('reply')
    expect(history[2]).toBeInstanceOf(HumanMessage)
    expect(history[2].name).toBe('Some_One')
  })

  it('puts the style note right before the last user message', async () => {
    names = ['EZ', 'pog']
    await chat({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ],
    })

    const types = llm.calls[0].messages.map(m => m.getType())
    expect(types).toEqual(['system', 'human', 'ai', 'system', 'human'])
    expect(llm.calls[0].messages[3].content).toContain('Style for this reply')
  })

  it('defaults the author to paulbeenis420', async () => {
    await chat()

    expect(llm.calls[0].messages[1].name).toBe('paulbeenis420')
  })

  it('calls the requested model with no schema or tools', async () => {
    await chat()

    const [call] = llm.calls
    expect(call.operation).toBe('playground.chat')
    expect(call.role).toBe('chat')
    expect(call.overrides).toEqual({ model: CHAT_MODEL, timeoutMs: 90_000 })
    expect(call.schema).toBeUndefined()
    expect(call.tools).toBeUndefined()
  })

  it.each([
    ['unknown', 'nope-1'],
    ['non-chat', 'gpt-image-1'],
  ])('throws for a %s model before any call', async (_, model) => {
    registry.isAllowedFor.mockReturnValue(false)

    await expect(chat({ model })).rejects.toThrow(PlaygroundModelError)
    expect(registry.isAllowedFor).toHaveBeenCalledWith(model, 'chat')
    expect(llm.calls).toHaveLength(0)
  })

  it('returns the raw output, the resolved reply and raw-based counts', async () => {
    const result = await chat()

    expect(result).toMatchObject({
      raw: RAW_REPLY,
      reply: RESOLVED_REPLY,
      model: CHAT_MODEL,
      usage: { input: 0, output: 0, cached: 0, costUsd: 0 },
      durationMs: 0,
      dictionarySize: 2,
    })
    expect(result.emojis.counts).toEqual({
      dictionary: 1,
      repaired: 1,
      hallucinated: 1,
      unicode: 1,
    })
    expect(result.emojis.dictionary[0]).toMatchObject({
      raw: ':EZ:',
      key: '<:EZ:758414734805696553>',
    })
    expect(result.emojis.repaired[0]).toMatchObject({
      raw: '<a:pog:758414734805696599>',
      key: '<a:pog:758414734805696554>',
      fixes: ['id'],
    })
    expect(result.emojis.hallucinated[0]).toMatchObject({
      raw: ':fake:',
      status: 'dropped',
      key: null,
    })
  })
})
