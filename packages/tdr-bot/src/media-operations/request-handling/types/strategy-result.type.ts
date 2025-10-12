import { BaseMessage } from '@langchain/core/messages'

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
}
