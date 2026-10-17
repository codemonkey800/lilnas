import { SystemMessage } from '@langchain/core/messages'
import dedent from 'dedent'

import {
  EMOJI_DESCRIPTION_MAX_CHARS,
  EMOJI_FRAME_COUNT,
} from 'src/emojis/emoji.constants'
import type { EmojiExample } from 'src/emojis/emoji-describer.service'

function formatExample({ name, animated, description }: EmojiExample): string {
  return `- ${name}${animated ? ' (animated)' : ''}: ${description}`
}

const BATCH_NOTE =
  'You get several emojis at once, each labeled with a number followed by its picture. Return exactly one description per emoji, keyed by that number. Make the descriptions distinct from one another so similar emojis can be told apart.'

export function buildEmojiDescriberSystemPrompt(
  examples: EmojiExample[],
  { batch = false }: { batch?: boolean } = {},
): SystemMessage {
  const lines = examples.map(formatExample).join('\n')

  const intro = dedent`
    You write one-line usage hints for a Discord friend group's custom emojis.

    Describe WHEN to use the emoji (the mood, reaction or situation it fits), not what it looks like. Keep it short and imperative, like the examples, and at most ${EMOJI_DESCRIPTION_MAX_CHARS} characters.

    The emoji's name usually carries its meaning; use the picture to tell similar names apart. An animated emoji marked "${EMOJI_FRAME_COUNT} frames" is shown as a grid of frames sampled evenly across one loop, in play order left to right, top to bottom; its meaning often lies in how it changes from frame to frame. One marked "still frame" is shown as a single frame.
  `

  return new SystemMessage(
    [intro, batch ? BATCH_NOTE : null, lines ? `Examples:\n${lines}` : null]
      .filter(part => part !== null)
      .join('\n\n'),
  )
}
