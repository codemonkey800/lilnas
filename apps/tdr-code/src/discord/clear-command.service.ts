import { Inject, Injectable } from '@nestjs/common'
import { Context, SlashCommand, type SlashCommandContext } from 'necord'

import { SessionManagerService } from 'src/agent/session-manager.service'
import { DB, type Db } from 'src/db/database.module'
import { clearAcpSessionId } from 'src/db/sessions.repo'

import { ContextUsageService } from './context-usage.service'
import { DiscordHandlerService } from './discord-handler.service'

@Injectable()
export class ClearCommandService {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly discordHandler: DiscordHandlerService,
    private readonly contextUsage: ContextUsageService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @SlashCommand({
    name: 'clear',
    description:
      'Force-stop the agent and reset this channel to a clean slate.',
  })
  async onClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const channelId = interaction.channelId

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

    await interaction.reply('Session cleared — next @mention starts fresh.')
  }
}
