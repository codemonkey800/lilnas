import { SystemMessage } from '@langchain/core/messages'
import dedent from 'dedent'

import { EMOJI_DESCRIPTION_MAX_CHARS } from 'src/emojis/emoji.constants'
import type { EmojiExample } from 'src/emojis/emoji-describer.service'

/** Hand-written hints from src/utils/emojis.ts, used when the dictionary is short. */
export const FALLBACK_EMOJI_EXAMPLES: EmojiExample[] = [
  {
    name: 'HYPERS',
    animated: false,
    description: 'Use this when excited about something',
  },
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
    name: 'salute1',
    animated: false,
    description: 'Show respect or acknowledgment',
  },
  {
    name: 'gasp',
    animated: false,
    description: 'React to something surprising or shocking',
  },
  {
    name: 'jackded',
    animated: false,
    description: 'Express feeling drained or exhausted',
  },
  {
    name: 'pathetic',
    animated: false,
    description: 'Mock or express disappointment humorously',
  },
  {
    name: 'Loading',
    animated: false,
    description: 'Indicate waiting or something in progress',
  },
]

function formatExample({ name, animated, description }: EmojiExample): string {
  return `- ${name}${animated ? ' (animated)' : ''}: ${description}`
}

export function buildEmojiDescriberSystemPrompt(
  examples: EmojiExample[],
): SystemMessage {
  const lines = examples.map(formatExample).join('\n')

  return new SystemMessage(dedent`
    You write one-line usage hints for a Discord friend group's custom emojis.

    Describe WHEN to use the emoji (the mood, reaction or situation it fits), not what it looks like. Keep it short and imperative, like the examples, and at most ${EMOJI_DESCRIPTION_MAX_CHARS} characters.

    The emoji's name usually carries its meaning; use the picture to tell similar names apart. Animated emojis are shown as a still frame.

    Examples:
    ${lines}
  `)
}
