import {
  analyzeEmojis,
  formatEmojiScore,
  resolveEmojis,
  segmentCustomEmojis,
} from 'src/emojis/emoji-analysis'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { emojiKey } from 'src/emojis/emoji-key'
import { ModelRegistry } from 'src/llm/models/model-registry'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { PlaygroundService } from 'src/playground/playground.service'
import { formatEmojiDictionary } from 'src/utils/prompts'

import { describeLive, LiveLlm, MAX_RUN_COST_USD, recordCost } from './live-env'

// Real emojis from the server. The prompt shows ':name:' keys; the resolver
// turns the model's shortcodes back into these rows' tokens.
const ROWS = [
  {
    id: '564310072822333480',
    name: 'HYPERS',
    animated: false,
    description: 'Use this when excited about something',
  },
  {
    id: '564330871851712553',
    name: 'residentsleeper',
    animated: false,
    description: 'Use when something is boring or putting you to sleep',
  },
  {
    id: '685953810413125686',
    name: 'gasp',
    animated: false,
    description: 'React to something surprising or shocking',
  },
  {
    id: '1266528661318926369',
    name: 'peepoWine',
    animated: true,
    description: 'Enjoy or relax with a wine theme',
  },
  {
    id: '1275667821757464687',
    name: 'Loading',
    animated: false,
    description: 'Indicate waiting or something in progress',
  },
]

const MODELS = ['gpt-4-turbo', 'gpt-5-mini']

describeLive('live playground chat', () => {
  const live = new LiveLlm()
  const keys = ROWS.map(emojiKey)
  const dictionary = {
    promptText: () =>
      formatEmojiDictionary(
        Object.fromEntries(ROWS.map(r => [`:${r.name}:`, r.description])),
      ),
    keys: () => keys,
    size: () => keys.length,
    resolve: (text: string) => resolveEmojis(text, keys),
  } as unknown as EmojiDictionaryService
  const settings = { get: () => defaultSettings() } as SettingsService
  const playground = new PlaygroundService(
    live.client,
    new ModelRegistry(),
    new PromptService(settings, dictionary),
    dictionary,
  )

  afterAll(() => {
    const total = recordCost('playground-chat', live.costUsd)
    expect(total).toBeLessThanOrEqual(MAX_RUN_COST_USD)
  })

  it.each(MODELS)(
    '%s replies through the playground service',
    async model => {
      const result = await playground.chat({
        model,
        messages: [
          {
            role: 'user',
            content: 'say hi to the server and tell me how your day is going',
          },
        ],
      })

      // The score is what the playground measures; the raw reply shows what
      // the model actually wrote before resolution.
      console.log(`[live] ${model}: ${formatEmojiScore(result.emojis.counts)}`)
      console.log(`[live] ${model} raw: ${result.raw}`)
      expect(result.raw.length).toBeGreaterThanOrEqual(1)
      expect(result.model).toBe(model)
      expect(result.usage.costUsd).toBeGreaterThan(0)
      expect(result.dictionarySize).toBe(keys.length)
      expect(result.emojis).toEqual(analyzeEmojis(result.raw, keys))
      expect(result.reply).toBe(resolveEmojis(result.raw, keys).text)
      // Everything Discord would get is a real dictionary emoji.
      for (const segment of segmentCustomEmojis(result.reply)) {
        if (segment.kind === 'emoji') {
          expect(keys).toContain(segment.emoji.raw)
        }
      }
    },
    120_000,
  )
})
