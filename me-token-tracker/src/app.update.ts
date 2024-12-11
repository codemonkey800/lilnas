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
    this.logger.log({
      info: 'ME token tracker bot initialized',
    })

    if (client.guilds.cache.size === 0) {
      this.logger.log({
        info: 'No guilds found, skipping setting price activity',
      })

      return
    }

    const price = await getMagicEdenTokenPrice()

    this.logger.log({
      info: 'Setting initial price activity',
      price,
    })

    setTokenPriceActivity(client, price)
  }

  @Once('guildCreate')
  async onJoinGuild(@Context() [client]: ContextOf<'ready'>) {
    const price = await getMagicEdenTokenPrice()

    this.logger.log({
      info: 'Joined a new guild, setting initial price activity',
      price,
    })

    setTokenPriceActivity(client, price)
  }
}
