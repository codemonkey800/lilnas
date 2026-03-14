import { MessageContent } from '@langchain/core/messages'

export class UnhandledMessageResponseError extends Error {
  constructor(
    message: string,
    public response: MessageContent,
  ) {
    super(message)
  }
}
