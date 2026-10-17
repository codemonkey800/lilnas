import {
  EMOJI_DESCRIBER_MODEL,
  EMOJI_DESCRIPTION_MAX_CHARS,
} from 'src/emojis/emoji.constants'
import {
  DescribeInput,
  EmojiDescriberService,
  EmojiExample,
} from 'src/emojis/emoji-describer.service'
import { EmojiImageService } from 'src/emojis/emoji-image.service'
import { ModelRegistry } from 'src/llm/models/model-registry'

import { describeLive, LiveLlm, MAX_RUN_COST_USD, recordCost } from './live-env'

// Real emojis from the server: a static one and an animated one.
const EMOJIS: DescribeInput[] = [
  { id: '564310072822333480', name: 'HYPERS', animated: false },
  { id: '1266528661318926369', name: 'peepoWine', animated: true },
  { id: '1275667821757464687', name: 'Loading', animated: false },
]

const EXAMPLES: EmojiExample[] = [
  {
    name: 'Jebaited',
    animated: false,
    description: 'Express surprise or indicate a successful trick or prank',
  },
  {
    name: 'residentsleeper',
    animated: false,
    description: 'Use when something is boring or putting you to sleep',
  },
  {
    name: 'gasp',
    animated: false,
    description: 'React to something surprising or shocking',
  },
]

describeLive('live emoji describer', () => {
  const live = new LiveLlm()
  const describer = new EmojiDescriberService(
    live.client,
    new ModelRegistry(),
    new EmojiImageService(),
  )

  afterAll(() => {
    const total = recordCost('emoji-describe', live.costUsd)
    expect(total).toBeLessThanOrEqual(MAX_RUN_COST_USD)
  })

  it.each(EMOJIS)(
    '$name gets a usage hint from the real model',
    async emoji => {
      const result = await describer.describe(emoji, EXAMPLES)

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
