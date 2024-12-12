import { Injectable, Logger } from '@nestjs/common'
import { ActivityType, Client } from 'discord.js'

import { getMagicEdenTokenPrice } from './utils/token'

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name)

  constructor(private readonly client: Client) {}

  async update() {
    if (this.client.guilds.cache.size === 0) {
      this.logger.log({
        info: 'No guilds found, skipping setting price activity',
      })

      return
    }

    const price = await getMagicEdenTokenPrice()
    const formattedPrice = price.toFixed(2)

    this.logger.log({
      info: 'Setting price activity',
      price: formattedPrice,
    })

    this.client.user?.setActivity(`$${formattedPrice}`, {
      type: ActivityType.Custom,
    })
  }
}
