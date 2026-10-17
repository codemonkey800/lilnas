import { HumanMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import {
  EMOJI_BATCH_TOKENS_PER_EMOJI,
  EMOJI_DESCRIBE_MAX_TOKENS,
  EMOJI_DESCRIBER_MODEL,
  EMOJI_DESCRIBER_REASONING_EFFORT,
  EMOJI_DESCRIPTION_MAX_CHARS,
  EMOJI_EXAMPLE_COUNT,
  EMOJI_FRAME_COUNT,
} from 'src/emojis/emoji.constants'
import { buildEmojiDescriberSystemPrompt } from 'src/emojis/emoji-describer.prompts'
import { EmojiImage, EmojiImageService } from 'src/emojis/emoji-image.service'
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

/** Batched answer: one entry per emoji, keyed by its 1-based position in the prompt. */
export const EmojiBatchSchema = z.object({
  descriptions: z.array(
    z.object({
      number: z.number().int(),
      description: z.string().min(1).max(EMOJI_DESCRIPTION_MAX_CHARS),
    }),
  ),
})

/** The text line naming an emoji, saying which kind of picture follows. */
function nameLine(emoji: DescribeInput, image: EmojiImage): string {
  if (!emoji.animated) return `Name: ${emoji.name}`
  const shown = image.frames ? `${EMOJI_FRAME_COUNT} frames` : 'still frame'
  return `Name: ${emoji.name} (animated, ${shown})`
}

/** Turns an emoji's name and picture into a one-line "when to use it" hint. */
@Injectable()
export class EmojiDescriberService {
  constructor(
    private readonly llm: LlmClient,
    private readonly registry: ModelRegistry,
    private readonly images: EmojiImageService,
  ) {}

  private assertVision(): void {
    if (!this.registry.get(EMOJI_DESCRIBER_MODEL).capabilities.vision) {
      throw new Error(
        `Emoji describer model '${EMOJI_DESCRIBER_MODEL}' does not support vision`,
      )
    }
  }

  async describe(
    emoji: DescribeInput,
    examples: EmojiExample[],
  ): Promise<DescribeResult> {
    this.assertVision()

    const systemPrompt = buildEmojiDescriberSystemPrompt(
      examples.slice(0, EMOJI_EXAMPLE_COUNT),
    )
    const image = await this.images.imageFor(emoji)
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
            { type: 'text', text: nameLine(emoji, image) },
            {
              type: 'image_url',
              image_url: { url: image.url, detail: 'low' },
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

  /**
   * Describes several emojis in one call, so the model sees them side by side
   * and can keep similar ones distinct. Returns descriptions by emoji id; an
   * emoji the model skipped is simply absent. Throws when the call itself fails.
   */
  async describeBatch(
    emojis: DescribeInput[],
    examples: EmojiExample[],
  ): Promise<Map<string, DescribeResult>> {
    this.assertVision()

    const images = await Promise.all(
      emojis.map(emoji => this.images.imageFor(emoji)),
    )
    const content = emojis.flatMap((emoji, i) => [
      {
        type: 'text' as const,
        text: `${i + 1}. ${nameLine(emoji, images[i])}`,
      },
      {
        type: 'image_url' as const,
        image_url: { url: images[i].url, detail: 'low' as const },
      },
    ])
    const result = await this.llm.call({
      operation: 'emoji.describe.batch',
      role: 'chat',
      schema: EmojiBatchSchema,
      overrides: {
        model: EMOJI_DESCRIBER_MODEL,
        maxTokens:
          EMOJI_DESCRIBE_MAX_TOKENS +
          EMOJI_BATCH_TOKENS_PER_EMOJI * emojis.length,
        reasoningEffort: EMOJI_DESCRIBER_REASONING_EFFORT,
      },
      messages: [
        buildEmojiDescriberSystemPrompt(
          examples.slice(0, EMOJI_EXAMPLE_COUNT),
          {
            batch: true,
          },
        ),
        new HumanMessage({ content }),
      ],
    })

    const described = new Map<string, DescribeResult>()
    for (const { number, description } of result.output.descriptions) {
      const emoji = emojis[number - 1]
      if (!emoji || described.has(emoji.id)) continue
      described.set(emoji.id, {
        description: description.trim(),
        model: result.model,
      })
    }
    return described
  }
}
