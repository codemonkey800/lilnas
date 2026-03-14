import { Injectable, Logger } from '@nestjs/common'
import { Once } from 'necord'

import { StatusService } from './status.service'

@Injectable()
export class AppEventsService {
  private readonly logger = new Logger(AppEventsService.name)

  constructor(private readonly status: StatusService) {}

  @Once('ready')
  async onReady() {
    this.logger.log({
      info: 'ME token tracker bot initialized',
    })

    this.status.update()
  }

  @Once('guildCreate')
  async onJoinGuild() {
    this.logger.log({
      info: 'Joined a new guild, setting initial price activity',
    })

    this.status.update()
  }
}
