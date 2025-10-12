import { AIMessage } from '@langchain/core/messages'

import { createAIMessage, createToolCall } from './messages.fixture'

/**
 * Integration Test Fixtures
 *
 * These fixtures provide realistic API responses for integration tests.
 * They simulate actual responses from OpenAI, Tavily, and other external services.
 */

/**
 * Simple chat responses
 */
export const INTEGRATION_CHAT_RESPONSES = {
  greeting: createAIMessage(
    'Hello! I am doing well, thank you for asking. How can I help you today?',
  ),
  followUp: createAIMessage(
    'I can help you with a variety of tasks including answering questions, searching the web, generating images, solving math problems, and finding movies or TV shows. What would you like to do?',
  ),
  contextResponse: createAIMessage(
    'Your name is Alice, as you mentioned earlier.',
  ),
}

/**
 * Math-related responses
 */
export const INTEGRATION_MATH_RESPONSES = {
  simpleCalculation: createAIMessage('The answer is 4.'),
  complexEquation: createAIMessage(
    'Let me solve that equation for you. The solution involves calculating the derivative.',
  ),
  mathDetection: createAIMessage('math'), // Response type detection: "math"
  mathResponse: createAIMessage('Let me solve that for you: 2 + 2 = 4'),
}

/**
 * Tool call responses
 */
export const INTEGRATION_TOOL_RESPONSES = {
  tavilySearchRequest: createAIMessage(
    'I will search for the latest AI news.',
    [
      createToolCall('tavily_search', {
        query: 'latest AI news 2025',
      }),
    ],
  ),
  tavilySearchResult: {
    query: 'latest AI news 2025',
    follow_up_questions: [],
    answer:
      'Recent developments in AI include major advances in large language models, improved reasoning capabilities, and new applications in healthcare and science.',
    images: [],
    results: [
      {
        title: 'Latest AI Developments 2025',
        url: 'https://example.com/ai-news',
        content:
          'Major AI companies have announced significant breakthroughs in reasoning and multimodal capabilities...',
        score: 0.95,
        raw_content: null,
      },
    ],
    response_time: 1.23,
  },
  afterToolExecution: createAIMessage(
    'Based on my search, recent developments in AI include major advances in large language models, improved reasoning capabilities, and new applications in healthcare and science. These breakthroughs are pushing the boundaries of what AI can accomplish.',
  ),
}

/**
 * Media request responses
 */
export const INTEGRATION_MEDIA_RESPONSES = {
  mediaDetection: createAIMessage('media'), // Response type detection: "media"
  movieSearchRequest: createAIMessage(
    'Let me search for the movie Inception for you.',
  ),
  tvShowSearchRequest: createAIMessage(
    'Let me search for the TV show Breaking Bad for you.',
  ),
}

/**
 * Image generation responses
 */
export const INTEGRATION_IMAGE_RESPONSES = {
  imageDetection: createAIMessage('image'), // Response type detection: "image"
  imageGenerationRequest: createAIMessage(
    'I will generate an image of a sunset over the ocean.',
  ),
  dalleResponse: {
    created: Date.now(),
    data: [
      {
        url: 'https://example.com/generated-sunset.png',
        revised_prompt:
          'A beautiful sunset over the ocean with vibrant orange and pink colors, waves gently rolling onto the shore',
      },
    ],
  },
}

/**
 * Error simulation responses
 */
export const INTEGRATION_ERROR_RESPONSES = {
  rateLimitError: {
    message: 'Rate limit exceeded',
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
  },
  apiError: {
    message: 'API request failed',
    type: 'api_error',
    code: 'internal_error',
  },
  timeoutError: {
    message: 'Request timeout',
    type: 'timeout_error',
    code: 'timeout',
  },
}

/**
 * Multi-step workflow responses
 */
export const INTEGRATION_MEDIA_WORKFLOWS = {
  movieSearchResults: createAIMessage(
    'I found the movie Inception (2010). It is a science fiction action film directed by Christopher Nolan.',
  ),
  movieSelectionConfirm: createAIMessage(
    'Great choice! I will download Inception (2010) for you.',
  ),
  movieDownloadConfirm: createAIMessage(
    'Download started for Inception (2010). I will notify you when it completes.',
  ),
  tvSearchResults: createAIMessage(
    'I found the TV show Breaking Bad (2008-2013). It is a crime drama series.',
  ),
  tvSelectionConfirm: createAIMessage(
    'Perfect! I will download Breaking Bad for you.',
  ),
  tvDownloadConfirm: createAIMessage(
    'Download started for Breaking Bad. I will notify you when it completes.',
  ),
  workflowCancelled: createAIMessage(
    'No problem! I have cancelled the operation. Let me know if you need anything else.',
  ),
}

/**
 * Context switching responses
 */
export const INTEGRATION_CONTEXT_SWITCH = {
  downloadToDeleteSwitch: createAIMessage(
    'Understood. I will delete that movie instead of downloading it.',
  ),
  movieToTvSwitch: createAIMessage(
    'Sure, let me search for Breaking Bad TV show instead.',
  ),
  deleteConfirmation: createAIMessage(
    'The movie has been deleted successfully.',
  ),
}

/**
 * Create a mock ChatOpenAI response stream
 * This can be used to simulate streaming responses if needed
 */
export function createMockChatResponse(
  content: string,
  toolCalls: any[] = [],
): AIMessage {
  return new AIMessage({
    content,
    additional_kwargs: toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  })
}

/**
 * Create integration test fixtures bundle
 */
export function createIntegrationFixtures() {
  return {
    chat: INTEGRATION_CHAT_RESPONSES,
    math: INTEGRATION_MATH_RESPONSES,
    tools: INTEGRATION_TOOL_RESPONSES,
    media: INTEGRATION_MEDIA_RESPONSES,
    images: INTEGRATION_IMAGE_RESPONSES,
    errors: INTEGRATION_ERROR_RESPONSES,
    workflows: INTEGRATION_MEDIA_WORKFLOWS,
    contextSwitch: INTEGRATION_CONTEXT_SWITCH,
  }
}
