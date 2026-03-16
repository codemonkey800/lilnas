import { Inject, Injectable } from '@nestjs/common'

import { IMessageHandler, MESSAGE_HANDLERS } from './handler.interface'

@Injectable()
export class HandlerRegistry {
  private readonly handlers: readonly IMessageHandler[]

  constructor(@Inject(MESSAGE_HANDLERS) handlers: IMessageHandler[]) {
    this.handlers = handlers
  }

  getHandlers(): readonly IMessageHandler[] {
    return this.handlers
  }
}
