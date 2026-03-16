import { Injectable } from '@nestjs/common'
import { Client } from 'discord.js'

import { Message } from 'src/messages/types'

import { IMessageMiddleware } from './middleware.interface'

@Injectable()
export class GuardMiddleware implements IMessageMiddleware {
  constructor(private readonly client: Client) {}

  process(message: Message): boolean {
    if (message.author.bot) return false
    if (message.author.id === this.client.user?.id) return false
    if (message.system) return false
    return true
  }
}
