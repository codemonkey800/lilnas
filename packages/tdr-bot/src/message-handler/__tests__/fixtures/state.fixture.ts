import { DEFAULT_CHAT_TEMPERATURE, DEFAULT_MAX_TOKENS } from 'src/constants/llm'
import { AppState } from 'src/state/state.service'
import { KAWAII_PROMPT } from 'src/utils/prompts'

/**
 * Create a mock AppState for testing
 */
export function createMockAppState(overrides?: Partial<AppState>): AppState {
  return {
    graphHistory: [],
    maxTokens: DEFAULT_MAX_TOKENS,
    chatModel: 'gpt-4-turbo',
    reasoningModel: 'gpt-4o-mini',
    prompt: KAWAII_PROMPT,
    temperature: DEFAULT_CHAT_TEMPERATURE,
    ...overrides,
  }
}
