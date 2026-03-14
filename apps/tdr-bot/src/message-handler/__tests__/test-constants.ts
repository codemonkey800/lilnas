/**
 * Test Constants
 *
 * Centralized constants for test fixtures and utilities.
 * Extracting magic numbers improves maintainability and makes tests more readable.
 */

/**
 * Default message IDs used in test fixtures
 */
export const DEFAULT_MESSAGE_IDS = {
  HUMAN: 'human-msg-1',
  AI: 'ai-msg-1',
  SYSTEM: 'system-msg-1',
  TOOL: 'tool-msg-1',
  TOOL_CALL: 'tool-call-1',
} as const

/**
 * Test user identifiers
 */
export const TEST_USERS = {
  DEFAULT_USER_ID: 'test-user-123',
} as const

/**
 * Test storage identifiers
 */
export const TEST_STORAGE = {
  BUCKET: 'test-bucket',
  EXAMPLE_IMAGE_URL: 'https://example.com/equation.png',
} as const

/**
 * Test timeout values (in milliseconds)
 */
export const TEST_TIMEOUTS = {
  STANDARD: 30000, // 30 seconds - standard test timeout
  LONG: 60000, // 60 seconds - long-running test timeout
  EXTRA_LONG: 120000, // 120 seconds - extra long test timeout (for 100+ turn tests)
  WAIT_FOR: 5000, // 5 seconds - waitFor default timeout
} as const

/**
 * Test interval values (in milliseconds)
 */
export const TEST_INTERVALS = {
  WAIT_FOR_CHECK: 100, // 100ms - waitFor check interval
} as const

/**
 * Performance test thresholds
 */
export const TEST_PERFORMANCE = {
  MAX_SIMPLE_CHAT_MS: 5000, // 5 seconds - maximum time for simple chat response
} as const
