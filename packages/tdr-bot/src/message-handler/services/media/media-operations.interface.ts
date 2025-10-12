import { BaseMessage, HumanMessage } from '@langchain/core/messages'

import { ImageResponse } from 'src/schemas/graph'

/**
 * Media operation response type
 */
export interface MediaOperationResponse {
  images: ImageResponse[]
  messages: BaseMessage[]
}

/**
 * Common interface for media operations services (movies and TV shows)
 * Provides consistent contract for handling search, selection, and media operations
 */
export interface MediaOperationsInterface<
  TContext,
  TResult = MediaOperationResponse,
> {
  /**
   * Handle new media search request
   * @param message User's search message
   * @param messages Conversation history
   * @param userId User identifier
   * @returns Promise resolving to message response
   */
  handleSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<TResult>

  /**
   * Handle user selection from search results
   * @param message User's selection message
   * @param messages Conversation history
   * @param context Current selection context
   * @param userId User identifier
   * @returns Promise resolving to message response
   */
  handleSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    context: TContext,
    userId: string,
  ): Promise<TResult>

  /**
   * Handle new media delete request
   * @param message User's delete message
   * @param messages Conversation history
   * @param userId User identifier
   * @returns Promise resolving to message response
   */
  handleDelete(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<TResult>

  /**
   * Handle user selection for deletion
   * @param message User's selection message
   * @param messages Conversation history
   * @param context Current delete context
   * @param userId User identifier
   * @returns Promise resolving to message response
   */
  handleDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    context: TContext,
    userId: string,
  ): Promise<TResult>
}
