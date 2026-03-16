import { Injectable, Logger } from '@nestjs/common'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { OverallStateAnnotation } from 'src/schemas/graph'

@Injectable()
export class MediaResponseNode {
  private readonly logger = new Logger(MediaResponseNode.name)

  constructor(private readonly mediaRequestHandler: MediaRequestHandler) {}

  async invoke({
    message,
    messages,
    userId,
  }: typeof OverallStateAnnotation.State): Promise<
    Partial<typeof OverallStateAnnotation.State>
  > {
    this.logger.log(
      { message: message.content, userId },
      'Processing media request',
    )

    return await this.mediaRequestHandler.handleRequest(
      message,
      messages,
      userId,
      undefined,
    )
  }
}
