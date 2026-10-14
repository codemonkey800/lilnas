import { z } from 'zod'

/**
 * Schema for parsing user search selection from natural language.
 * This represents how to select which item from search results:
 * - ordinal: "first one", "second", "last one"
 * - year: "from 2008", "the 2008 version"
 */
export const SearchSelectionSchema = z.object({
  selectionType: z.enum(['ordinal', 'year']),
  value: z.string(),
})

export type SearchSelection = z.infer<typeof SearchSelectionSchema>

/**
 * `SearchSelectionSchema` as the LLM fills it in. Strict structured output
 * can't return a different shape, so a message that picks nothing comes back
 * with both fields `null` - without that way out, the model is forced to
 * invent a pick ("download Vision Quest" parsed as "the first one").
 */
export const SearchSelectionLlmSchema = z.object({
  selectionType: z.enum(['ordinal', 'year']).nullable(),
  value: z.string().nullable(),
})
