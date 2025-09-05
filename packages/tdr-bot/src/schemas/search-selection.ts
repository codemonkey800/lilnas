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
