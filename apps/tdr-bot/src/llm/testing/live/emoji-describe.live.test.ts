import {
  EMOJI_DESCRIBER_MODEL,
  EMOJI_DESCRIPTION_MAX_CHARS,
} from 'src/emojis/emoji.constants'
import { FALLBACK_EMOJI_EXAMPLES } from 'src/emojis/emoji-describer.prompts'
import {
  DescribeInput,
  EmojiDescriberService,
} from 'src/emojis/emoji-describer.service'
import { ModelRegistry } from 'src/llm/models/model-registry'

import { describeLive, LiveLlm, MAX_RUN_COST_USD, recordCost } from './live-env'

// Real emojis from the server: a static one, an animated one and one whose
// name is also a fallback example.
const EMOJIS: DescribeInput[] = [
  { id: '564310072822333480', name: 'HYPERS', animated: false },
  { id: '1266528661318926369', name: 'peepoWine', animated: true },
  { id: '1275667821757464687', name: 'Loading', animated: false },
]

describeLive('live emoji describer', () => {
  const live = new LiveLlm()
  const describer = new EmojiDescriberService(live.client, new ModelRegistry())

  afterAll(() => {
    const total = recordCost('emoji-describe', live.costUsd)
    expect(total).toBeLessThanOrEqual(MAX_RUN_COST_USD)
  })

  it.each(EMOJIS)(
    '$name gets a usage hint from the real model',
    async emoji => {
      const result = await describer.describe(emoji, FALLBACK_EMOJI_EXAMPLES)

      console.log(`[live] ${emoji.name}: ${result.description}`)
      expect(result.description.length).toBeGreaterThanOrEqual(1)
      expect(result.description.length).toBeLessThanOrEqual(
        EMOJI_DESCRIPTION_MAX_CHARS,
      )
      expect(result.model).toBe(EMOJI_DESCRIBER_MODEL)
      expect(result.model).toBe('gpt-6-luna')
    },
    120_000,
  )
})
