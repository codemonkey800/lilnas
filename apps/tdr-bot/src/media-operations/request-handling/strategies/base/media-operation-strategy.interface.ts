import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'

/**
 * Base interface for all media operation strategies
 *
 * Each strategy encapsulates a specific media operation flow:
 * - Download movies/TV shows
 * - Delete movies/TV shows
 * - Browse media library
 * - Check download status
 */
export interface MediaOperationStrategy {
  /**
   * Handle a media operation request
   *
   * @param params - Request parameters including message, conversation history, user ID, and optional context
   * @returns Strategy result with images and messages to append
   */
  handleRequest(params: StrategyRequestParams): Promise<StrategyResult>
}
