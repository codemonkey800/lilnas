import { AIMessage, HumanMessage } from '@langchain/core/messages'

// ============================================================================
// Message Factory Functions
// ============================================================================

export function createMockChatResponse(
  content: string,
  id = 'mock-response-id',
): HumanMessage {
  return new HumanMessage({ id, content })
}

export function createMockAIResponse(content: string): AIMessage {
  return new AIMessage({ content })
}

// ============================================================================
// Common Pre-built Responses
// ============================================================================

export const mockSuccessResponse = createMockChatResponse(
  'Operation completed successfully',
)

export const mockErrorResponse = createMockChatResponse(
  'Sorry, an error occurred while processing your request',
)

export const mockBrowsingResponse = createMockChatResponse(
  'Here are the results from your library...',
)

export const mockDownloadStatusResponse = createMockChatResponse(
  'You have 2 movies and 1 episode downloading...',
)

export const mockNoDownloadsResponse = createMockChatResponse(
  'No downloads are currently active',
)
