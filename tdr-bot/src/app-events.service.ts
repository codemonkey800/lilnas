import { Injectable, Logger } from '@nestjs/common'
import { Context, ContextOf, Once } from 'necord'

import { getErrorMessage } from './utils/error'

const TDR_BOT_DEV_ID = '1068081514451058698'

@Injectable()
export class AppEventsService {
  private readonly logger = new Logger(AppEventsService.name)

  @Once('ready')
  async onReady(@Context() [client]: ContextOf<'ready'>) {
    // Skip notification if running in dev mode
    if (client.user?.id === TDR_BOT_DEV_ID) {
      return
    }

    const readyMessage = 'TDR bot initialized'
    this.logger.log({ info: readyMessage })

    try {
      const channels = client.guilds.cache.flatMap((guild) =>
        guild.channels.cache.filter(
          (channel) => channel.name === 'tdr-bot-chat',
        ),
      )

      await Promise.allSettled(
        channels.map(async (channel) => {
          if (!channel.isTextBased()) {
            return
          }

          await channel.send(
            `${readyMessage} <a:peepoArrive:758419118957002765>`,
          )
        }),
      )
    } catch (err) {
      this.logger.error({
        error: getErrorMessage(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      })
    }
  }
}
