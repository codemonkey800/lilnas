import { z } from 'zod'

import { ResponseType } from 'src/schemas/graph'

/**
 * Zod schemas for LLM-related data validation
 *
 * These schemas provide runtime validation for data coming from LLM APIs
 * to ensure type safety and catch unexpected response formats early.
 */

/**
 * Schema for validating string content from LLM responses
 *
 * Ensures the content is a non-empty string, which is the expected format
 * for most LLM text responses.
 */
export const LLMStringContentSchema = z
  .string()
  .min(1, 'LLM content must not be empty')

/**
 * Schema for validating ResponseType enum values
 *
 * Ensures the response type is one of the valid ResponseType enum values.
 */
export const ResponseTypeContentSchema = z.nativeEnum(ResponseType, {
  message: `Invalid response type. Must be one of: ${Object.values(ResponseType).join(', ')}`,
})

/**
 * Schema for validating tool call structures
 *
 * Validates the structure of tool calls returned by the LLM, ensuring
 * all required fields are present and have the correct types.
 */
export const ToolCallSchema = z.object({
  name: z.string().min(1, 'Tool call name must not be empty'),
  args: z.record(z.string(), z.unknown()),
  id: z.string().optional(),
})

/**
 * Schema for an array of tool calls
 */
export const ToolCallArraySchema = z.array(ToolCallSchema)

/**
 * Type inference helpers
 */
export type ToolCallValidated = z.infer<typeof ToolCallSchema>
export type ToolCallArrayValidated = z.infer<typeof ToolCallArraySchema>
