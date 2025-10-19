import { BaseMessage } from '@langchain/core/messages'

/**
 * Type guard utilities for runtime type checking
 *
 * These functions provide safe runtime type checking to replace unsafe type assertions.
 * They follow TypeScript's type predicate pattern to narrow types safely.
 */

/**
 * Type guard to check if a value is an Error instance
 *
 * @param value - Value to check
 * @returns True if value is an Error
 *
 * @example
 * ```typescript
 * try {
 *   // ...
 * } catch (err) {
 *   if (isError(err)) {
 *     console.log(err.message) // Safe to access Error properties
 *   }
 * }
 * ```
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/**
 * Type guard to check if a value is a string
 *
 * @param value - Value to check
 * @returns True if value is a string
 *
 * @example
 * ```typescript
 * const content = message.content
 * if (isString(content)) {
 *   console.log(content.toLowerCase()) // Safe to use string methods
 * }
 * ```
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Type definition for LangChain tool calls
 */
export interface ToolCall {
  name: string
  args: Record<string, unknown>
  id?: string
}

/**
 * Type guard to check if a message has tool calls
 *
 * This provides a narrower type than the generic BaseMessage,
 * allowing safe access to the tool_calls property.
 *
 * @param message - Message to check
 * @returns True if message has tool calls
 *
 * @example
 * ```typescript
 * if (hasToolCalls(message)) {
 *   message.tool_calls.forEach(call => {
 *     console.log(call.name) // Safe to access tool call properties
 *   })
 * }
 * ```
 */
export function hasToolCalls(
  message: BaseMessage,
): message is BaseMessage & { tool_calls: ToolCall[] } {
  return (
    'tool_calls' in message &&
    message.tool_calls !== undefined &&
    message.tool_calls !== null &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  )
}

/**
 * Generic type guard to check if an object has a specific property
 *
 * @param obj - Object to check
 * @param key - Property key to check for
 * @returns True if object has the property
 *
 * @example
 * ```typescript
 * if (hasProperty(obj, 'name')) {
 *   console.log(obj.name) // Safe to access property
 * }
 * ```
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return typeof obj === 'object' && obj !== null && key in obj
}

/**
 * Type guard to check if a value is a non-null object
 *
 * @param value - Value to check
 * @returns True if value is an object (excluding null)
 *
 * @example
 * ```typescript
 * if (isObject(value)) {
 *   // Safe to check for properties
 *   if ('key' in value) {
 *     // ...
 *   }
 * }
 * ```
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Type guard to check if a value is defined (not null or undefined)
 *
 * @param value - Value to check
 * @returns True if value is not null or undefined
 *
 * @example
 * ```typescript
 * const result = maybeGetValue()
 * if (isDefined(result)) {
 *   // result is not null or undefined
 *   console.log(result)
 * }
 * ```
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}
