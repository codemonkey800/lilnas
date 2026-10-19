import { z } from 'zod'

import { stripCitations } from './transcript'
import { MAX_MODEL_MESSAGE_CHARS, MAX_MODEL_MESSAGES } from './types'

/** Fewest letters and digits a reply needs, citations and joiners aside. */
const MIN_PROSE_CHARS = 3

/** Letters and digits left once citations and "and" joiners are removed. */
function proseLength(messages: string[]): number {
  const prose = stripCitations(messages.join(' ')).replace(/\band\b/gi, '')
  return prose.match(/[\p{L}\p{N}]/gu)?.length ?? 0
}

/**
 * What the model returns: the reply as Discord messages. Length limits live in
 * the descriptions and are enforced by the caller, because the provider's
 * structured-output mode does not take them. A reply that is only citations
 * fails the parse, so the client retries it.
 */
export const TldrReplySchema = z
  .object({
    messages: z
      .array(z.string())
      .describe(
        `The reply as Discord messages, in order. Use one message unless the reply needs more than ${MAX_MODEL_MESSAGE_CHARS} characters; then continue in further messages, at most ${MAX_MODEL_MESSAGES}, each at most ${MAX_MODEL_MESSAGE_CHARS} characters, breaking between topics.`,
      ),
  })
  .refine(({ messages }) => proseLength(messages) >= MIN_PROSE_CHARS, {
    message: 'Reply has no readable text outside citations',
  })

export type TldrReply = z.infer<typeof TldrReplySchema>
