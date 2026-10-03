import { BaseMessage } from '@langchain/core/messages'

import type { ActiveMediaContext } from './request-context.type'

/**
 * Result returned by media operation strategies
 */
export interface StrategyResult {
  /**
   * Images generated during the operation (e.g., for math responses)
   */
  images: Array<{
    title: string
    url: string
    parentId?: string
  }>

  /**
   * Messages to append to conversation history
   */
  messages: BaseMessage[]

  /**
   * Multi-turn state to carry into the next message: the strategy is waiting
   * for the user to pick from a list. The caller hands it back to
   * `MediaRequestHandler.handleRequest` as `activeContext`. Absent or null
   * means nothing is pending, so it also clears any earlier context.
   */
  pendingContext?: ActiveMediaContext | null

  /**
   * Set when the message switched topics instead of answering the active
   * context: nothing was handled, and the caller should route the message
   * afresh. `messages` is empty.
   */
  reroute?: true
}
