import { Injectable, Logger } from '@nestjs/common'
import { Client } from 'discord.js'
import { Context, ContextOf, Once } from 'necord'

import { getMagicEdenTokenPrice, setTokenPriceActivity } from './utils/token'

@Injectable()
export class AppUpdate {
  private readonly logger = new Logger(AppUpdate.name)

  public constructor(private readonly client: Client) {}

  @Once('ready')
  async onReady(@Context() [client]: ContextOf<'ready'>) {
    const price = await getMagicEdenTokenPrice()

    this.logger.log({
      info: 'ME token tracker bot initialized, setting price activity',
      price,
    })

    if (client.guilds.cache.size === 0) {
      this.logger.log({
        info: 'No guilds found, skipping setting price activity',
      })
    }

    setTokenPriceActivity(client, price)
  }
}
