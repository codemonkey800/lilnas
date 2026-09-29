import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import type { QualityTier } from '@lilnas/utils/download/types'

/**
 * The Discord user behind a chat message, carried to every strategy so a
 * request it forwards to the download app is attributed to that user
 * (`DownloadClientFactory.forDiscord` turns it into `x-discord-*` headers).
 *
 * `username` is the unique handle (`User.username`), not the display name;
 * `displayName` is Discord's `globalName`, absent when the user has none set.
 */
export interface DiscordIdentity {
  userId: string
  username: string
  displayName?: string
}

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
   * The Discord user who sent `message`, for attributing anything the
   * strategy asks the download app to do on their behalf
   */
  discord: DiscordIdentity

  /**
   * The quality tier the user asked for in `message` ("in 4k"), for a
   * download request. Absent means none was asked for, and the request
   * leaves it off so the download app's default tier applies.
   */
  qualityTier?: QualityTier

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
