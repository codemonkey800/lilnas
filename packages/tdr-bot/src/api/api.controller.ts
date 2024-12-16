import { Controller, Get } from '@nestjs/common'

import { StateService } from 'src/state/state.service'

import { MessageState } from './api.types'

@Controller()
export class ApiController {
  constructor(private readonly state: StateService) {}

  @Get('messages')
  getMessages(): MessageState[] {
    return this.state.getState().messages.map((message) => ({
      id: message.id,
      type: message.getType(),
      kwargs: message.additional_kwargs,

      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content, null, 2),
    }))
  }
}
