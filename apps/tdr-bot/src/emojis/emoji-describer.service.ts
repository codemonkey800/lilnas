import { HumanMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import {
  EMOJI_DESCRIBE_MAX_TOKENS,
  EMOJI_DESCRIBER_MODEL,
  EMOJI_DESCRIBER_REASONING_EFFORT,
  EMOJI_DESCRIPTION_MAX_CHARS,
  EMOJI_EXAMPLE_COUNT,
} from 'src/emojis/emoji.constants'
import {
  buildEmojiDescriberSystemPrompt,
  FALLBACK_EMOJI_EXAMPLES,
} from 'src/emojis/emoji-describer.prompts'
import { LlmClient } from 'src/llm/client/llm-client'
import { ModelRegistry } from 'src/llm/models/model-registry'

export interface DescribeInput {
  id: string
  name: string
  animated: boolean
}

export interface EmojiExample {
  name: string
  animated: boolean
  description: string
}

export interface DescribeResult {
  description: string
  model: string
}

export const EmojiDescriptionSchema = z.object({
  description: z.string().min(1).max(EMOJI_DESCRIPTION_MAX_CHARS),
})

/** Below this many examples, top up from the hand-written fallbacks. */
const MIN_EXAMPLES = FALLBACK_EMOJI_EXAMPLES.length

/** Static PNG on Discord's CDN; a still frame for animated emojis. */
export function emojiPngUrl(id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.png`
}

function withFallbackExamples(examples: EmojiExample[]): EmojiExample[] {
  if (examples.length >= MIN_EXAMPLES) {
    return examples.slice(0, EMOJI_EXAMPLE_COUNT)
  }
  const names = new Set(examples.map(example => example.name))
  const fallbacks = FALLBACK_EMOJI_EXAMPLES.filter(
    example => !names.has(example.name),
  )
  return [...examples, ...fallbacks].slice(0, EMOJI_EXAMPLE_COUNT)
}

/** Turns an emoji's name and picture into a one-line "when to use it" hint. */
@Injectable()
export class EmojiDescriberService {
  constructor(
    private readonly llm: LlmClient,
    private readonly registry: ModelRegistry,
  ) {}

  async describe(
    emoji: DescribeInput,
    examples: EmojiExample[],
  ): Promise<DescribeResult> {
    if (!this.registry.get(EMOJI_DESCRIBER_MODEL).capabilities.vision) {
      throw new Error(
        `Emoji describer model '${EMOJI_DESCRIBER_MODEL}' does not support vision`,
      )
    }

    const systemPrompt = buildEmojiDescriberSystemPrompt(
      withFallbackExamples(examples),
    )
    const result = await this.llm.call({
      operation: 'emoji.describe',
      role: 'chat',
      schema: EmojiDescriptionSchema,
      overrides: {
        model: EMOJI_DESCRIBER_MODEL,
        maxTokens: EMOJI_DESCRIBE_MAX_TOKENS,
        reasoningEffort: EMOJI_DESCRIBER_REASONING_EFFORT,
      },
      messages: [
        systemPrompt,
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: `Name: ${emoji.name}${emoji.animated ? ' (animated)' : ''}`,
            },
            {
              type: 'image_url',
              image_url: { url: emojiPngUrl(emoji.id), detail: 'low' },
            },
          ],
        }),
      ],
    })

    return {
      description: result.output.description.trim(),
      model: result.model,
    }
  }
}
