import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Context, type ContextOf, On, Once } from 'necord'

import { EMOJI_RECONCILE_CRON } from 'src/emojis/emoji.constants'
import { EmojiSyncService } from 'src/emojis/emoji-sync.service'

/**
 * Triggers for {@link EmojiSyncService}: a reconcile on boot and nightly,
 * and single-emoji upserts on gateway events. No handler throws.
 */
@Injectable()
export class EmojiEventsService {
  private readonly logger = new Logger(EmojiEventsService.name)

  constructor(private readonly sync: EmojiSyncService) {}

  /** Starts the boot reconcile without waiting for it. */
  @Once('clientReady')
  onClientReady(): void {
    void this.sync.reconcile('boot').catch(err => {
      this.logger.error(
        { trigger: 'boot', error: getErrorMessage(err) },
        'emoji.reconcile.failed',
      )
    })
  }

  @On('emojiCreate')
  async onEmojiCreate(
    @Context() [emoji]: ContextOf<'emojiCreate'>,
  ): Promise<void> {
    await this.syncEmoji(emoji)
  }

  @On('emojiUpdate')
  async onEmojiUpdate(
    @Context() [, emoji]: ContextOf<'emojiUpdate'>,
  ): Promise<void> {
    await this.syncEmoji(emoji)
  }

  @On('emojiDelete')
  async onEmojiDelete(
    @Context() [emoji]: ContextOf<'emojiDelete'>,
  ): Promise<void> {
    try {
      await this.sync.removeEmoji(emoji.id)
    } catch (err) {
      this.logger.error(
        { emojiId: emoji.id, error: getErrorMessage(err) },
        'emoji.remove.failed',
      )
    }
  }

  @Cron(EMOJI_RECONCILE_CRON)
  async onNightly(): Promise<void> {
    try {
      await this.sync.reconcile('cron')
    } catch (err) {
      this.logger.error(
        { trigger: 'cron', error: getErrorMessage(err) },
        'emoji.reconcile.failed',
      )
    }
  }

  private async syncEmoji(emoji: ContextOf<'emojiCreate'>[0]): Promise<void> {
    try {
      await this.sync.syncEmoji(emoji)
    } catch (err) {
      this.logger.error(
        { emojiId: emoji.id, error: getErrorMessage(err) },
        'emoji.sync.failed',
      )
    }
  }
}
