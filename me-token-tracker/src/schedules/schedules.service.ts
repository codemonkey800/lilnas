import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Client } from 'discord.js'

import { StatusService } from 'src/status.service'

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name)

  constructor(
    private readonly client: Client,
    private readonly status: StatusService,
  ) {}

  @Cron('* * * * *')
  async updatePriceStatus() {
    if (this.client.guilds.cache.size === 0) {
      this.logger.log({
        info: 'No guilds found, skipping setting price activity',
      })

      return
    }

    this.status.update()
  }
}
