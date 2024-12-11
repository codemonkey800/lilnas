import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Client } from 'discord.js'

import { getMagicEdenTokenPrice, setTokenPriceActivity } from 'src/utils/token'

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name)

  constructor(private readonly client: Client) {}

  @Cron('* * * * *')
  async updatePriceStatus() {
    const price = await getMagicEdenTokenPrice()

    this.logger.log({ info: 'Updating price status', price })

    await setTokenPriceActivity(this.client, price)
  }
}
