import { BaseMessage, HumanMessage } from '@langchain/core/messages'

/**
 * Parameters passed to media operation strategies
 */
export interface StrategyRequestParams {
  /**
   * The current user message
   */
  message: HumanMessage

  /**
   * Conversation history
   */
  messages: BaseMessage[]

  /**
   * User ID for context tracking
   */
  userId: string

  /**
   * Optional active context (for multi-turn operations)
   */
  context?: unknown

  /**
   * Optional LangGraph state
   */
  state?: unknown
}

/**
 * Context types for tracking active operations
 */
export enum MediaContextType {
  MovieDownload = 'movie_download',
  TvDownload = 'tv_download',
  MovieDelete = 'movie_delete',
  TvDelete = 'tv_delete',
}

/**
 * Active context information
 */
export interface ActiveContext {
  type: MediaContextType
  userId: string
  context: unknown
}
