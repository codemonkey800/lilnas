import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { ActivityType, Client } from 'discord.js'
import { Context, type ContextOf, On, Once } from 'necord'

const startedAtFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

/** e.g. "Up since Thu, Sep 24, 3:42 PM PDT" */
export function formatStartedStatus(startedAt: Date): string {
  return `Up since ${startedAtFormatter.format(startedAt)}`
}

@Injectable()
export class AppEventsService {
  private readonly logger = new Logger(AppEventsService.name)
  private readonly startedAt = new Date()

  constructor(private readonly client: Client) {}

  @Once('ready')
  onReady() {
    this.logger.log({ info: 'TDR bot initialized' })
  }

  /**
   * Fires on every fresh gateway session, not just the first. A reconnect
   * that re-identifies drops runtime presence, so the status is re-applied
   * here rather than set once in `onReady`.
   */
  @On('shardReady')
  onShardReady(@Context() [shardId]: ContextOf<'shardReady'>) {
    const status = formatStartedStatus(this.startedAt)

    try {
      this.client.user?.setPresence({
        activities: [
          { name: status, state: status, type: ActivityType.Custom },
        ],
        shardId,
      })
    } catch (err) {
      this.logger.error({
        error: getErrorMessage(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      })
    }
  }
}
