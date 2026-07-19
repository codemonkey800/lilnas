import { Inject, Injectable } from '@nestjs/common'
import { Client } from 'discord.js'
import { Context, SlashCommand, type SlashCommandContext } from 'necord'
import { PinoLogger } from 'nestjs-pino'

import { SessionManagerService } from 'src/agent/session-manager.service'
import { DB, type Db } from 'src/db/database.module'
import { clearAcpSessionId } from 'src/db/sessions.repo'
import { LOG_EVENTS } from 'src/logging/log-events'

import { ContextUsageService } from './context-usage.service'
import { DiscordHandlerService } from './discord-handler.service'
import { isThreadChannel } from './fetch-channel'

@Injectable()
export class ClearCommandService {
  constructor(
    @Inject(Client) private readonly client: Client,
    private readonly sessionManager: SessionManagerService,
    private readonly discordHandler: DiscordHandlerService,
    private readonly contextUsage: ContextUsageService,
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  @SlashCommand({
    name: 'clear',
    description:
      'Force-stop the agent and reset this channel to a clean slate.',
  })
  async onClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const channelId = interaction.channelId
    this.logger.info(
      { event: LOG_EVENTS.clearInvoked, channelId },
      '/clear invoked',
    )

    // Each thread is its own agent session — running this outside a thread
    // has no session boundary to reset.
    if (!(await isThreadChannel(this.client, channelId))) {
      this.logger.info(
        { event: LOG_EVENTS.clearRejectedNotThread, channelId },
        '/clear rejected — not a thread',
      )
      await interaction.reply('⚠️ `/clear` can only be used inside a thread.')
      return
    }

    try {
      // Order matters: resetChannel deletes channelStates + arms the cleared-channel
      // guard BEFORE teardown fires the synchronous onPromptComplete('aborted'), so
      // the abort finds no state and cannot flush a partial reply (Decision #5).
      this.discordHandler.resetChannel(channelId)
      // A forced-fresh session must not inherit a stale notifiedThreshold from
      // whatever this channel's usage was before /clear.
      this.contextUsage.resetChannel(channelId)
      this.sessionManager.teardown(channelId)
      // U8: cancel any in-flight pending create/reactivate attempt for this
      // channel BEFORE severing acpSessionId below. A pending attempt (a future
      // unit's reactivation) reads acpSessionId again just before committing its
      // DB insert — cancelling first means that re-check sees "cancelled" even
      // if the attempt's read of acpSessionId raced ahead of this UPDATE, so a
      // /clear landing mid-attempt can't be silently ignored by an attempt that
      // was already past the point of observing the null.
      this.sessionManager.cancelPending(channelId)
      // Sever the resume linkage on the channel's latest row whether or not a
      // live session existed (dormant channels have no in-memory session for
      // teardown to act on) — the next @mention must start fresh, not resume.
      clearAcpSessionId(this.db, channelId)
    } catch (err) {
      this.logger.error(
        { event: LOG_EVENTS.clearFailed, err, channelId },
        '/clear failed partway through',
      )
      throw err
    }

    this.logger.info(
      { event: LOG_EVENTS.clearCompleted, channelId },
      '/clear completed',
    )
    await interaction.reply('Session cleared — next @mention starts fresh.')
  }
}
