import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Client } from 'discord.js'

import { getWeeklyCookiesMessage } from 'src/utils/crumbl'

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name)

  constructor(private readonly client: Client) {}

  @Cron('0 10 * * 1')
  async sendCookies() {
    this.logger.log({ log: 'Executing crumbl cookies command' })

    // Find all channels named 'food'
    const channels = this.client.guilds.cache.flatMap((guild) =>
      guild.channels.cache.filter((channel) => channel.name === 'food'),
    )
    const totalChannels = channels.reduce((total) => total + 1, 0)
    this.logger.log({ log: `Sending to ${totalChannels} channels ` })

    // Send weekly Crumbl cookies message to each channel and wait for all to finish
    await Promise.allSettled(
      channels.map(async (channel) => {
        if (!channel.isTextBased()) {
          return
        }
        this.logger.log({
          log: 'Finished sending weekly Crumbl cookies',

          channel: {
            id: channel.id,
            name: channel.name,
          },

          guild: {
            id: channel.guild.id,
            name: channel.guild.name,
          },
        })
        await channel.send(await getWeeklyCookiesMessage({ showEmbeds: true }))
      }),
    )
  }
}
