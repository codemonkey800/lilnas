import { analyzeEmojis, formatEmojiScore } from 'src/emojis/emoji-analysis'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { ModelRegistry } from 'src/llm/models/model-registry'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { PlaygroundService } from 'src/playground/playground.service'
import { formatEmojiDictionary } from 'src/utils/prompts'

import { describeLive, LiveLlm, MAX_RUN_COST_USD, recordCost } from './live-env'

// Real emojis from the server, keyed the way the prompt shows them.
const FIXTURE: Record<string, string> = {
  '<:HYPERS:564310072822333480>': 'Use this when excited about something',
  '<:residentsleeper:564330871851712553>':
    'Use when something is boring or putting you to sleep',
  '<:gasp:685953810413125686>': 'React to something surprising or shocking',
  '<a:peepoWine:1266528661318926369>': 'Enjoy or relax with a wine theme',
  '<:Loading:1275667821757464687>': 'Indicate waiting or something in progress',
}

const MODELS = ['gpt-4-turbo', 'gpt-5-mini']

describeLive('live playground chat', () => {
  const live = new LiveLlm()
  const keys = Object.keys(FIXTURE)
  const dictionary = {
    promptText: () => formatEmojiDictionary(FIXTURE),
    keys: () => keys,
    size: () => keys.length,
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

      // Emoji counts are what the playground measures, so only log them.
      console.log(`[live] ${model}: ${formatEmojiScore(result.emojis.counts)}`)
      console.log(`[live] ${model} reply: ${result.reply}`)
      expect(result.reply.length).toBeGreaterThanOrEqual(1)
      expect(result.model).toBe(model)
      expect(result.usage.costUsd).toBeGreaterThan(0)
      expect(result.dictionarySize).toBe(keys.length)
      expect(result.emojis).toEqual(analyzeEmojis(result.reply, keys))
    },
    120_000,
  )
})
