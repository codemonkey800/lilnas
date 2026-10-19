import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'

import { createTestingModule } from 'src/__tests__/test-utils'
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
import { INPUT_FORMAT, PROMPT_INTRO } from 'src/utils/prompts'

const SAVED_PROMPT = 'Be a helpful kawaii assistant.'
const DICTIONARY_TEXT =
  'FAKE EMOJI DICTIONARY {"<:EZ:758414734805696553>":"smug"}'
const KEYS = ['<:EZ:758414734805696553>', '<a:pog:758414734805696554>']
const CHAT_MODEL = 'gpt-6-luna'

describe('PlaygroundService', () => {
  let service: PlaygroundService
  let llm: FakeLlmClient
  let registry: { isAllowedFor: jest.Mock }

  beforeEach(async () => {
    llm = new FakeLlmClient().script(
      'playground.chat',
      'hi <:EZ:758414734805696553> <:fake:758414734805696555> 😀',
    )
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
    expect(content.endsWith(DICTIONARY_TEXT)).toBe(true)
  })

  it('uses the draft instead of the saved prompt when given', async () => {
    await chat({ systemPromptDraft: '  Draft prompt.  ' })

    const content = systemContent()
    expect(content.startsWith(PROMPT_INTRO.trim())).toBe(true)
    expect(content).toContain('Draft prompt.')
    expect(content).not.toContain(SAVED_PROMPT)
    expect(content.endsWith(DICTIONARY_TEXT)).toBe(true)
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

  it('returns the reply with usage and an analysis against keys()', async () => {
    const result = await chat()

    expect(result).toMatchObject({
      reply: 'hi <:EZ:758414734805696553> <:fake:758414734805696555> 😀',
      model: CHAT_MODEL,
      usage: { input: 0, output: 0, cached: 0, costUsd: 0 },
      durationMs: 0,
      dictionarySize: 2,
    })
    expect(result.emojis.counts).toEqual({
      dictionary: 1,
      hallucinated: 1,
      unicode: 1,
      shortcode: 0,
    })
    expect(result.emojis.dictionary[0].raw).toBe('<:EZ:758414734805696553>')
    expect(result.emojis.hallucinated[0]).toMatchObject({
      name: 'fake',
      reason: 'unknown',
    })
  })
})
