import { Injectable, Logger } from '@nestjs/common'
import { Context, ContextOf, Once } from 'necord'

import { getErrorMessage } from './utils/error'

const PAUL_BEENIS_ID = '218579527041941507'

@Injectable()
export class AppEventsService {
  private readonly logger = new Logger(AppEventsService.name)

  @Once('ready')
  async onReady(@Context() [client]: ContextOf<'ready'>) {
    const readyMessage = 'TDR bot initialized'
    this.logger.log({ info: readyMessage })

    try {
      const user = await client.users.fetch(PAUL_BEENIS_ID)

      if (!user) {
        throw new Error('Unable to fetch paulbeenis')
      }

      await user.send(readyMessage)
    } catch (err) {
      this.logger.error({
        error: getErrorMessage(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      })
    }
  }
}
