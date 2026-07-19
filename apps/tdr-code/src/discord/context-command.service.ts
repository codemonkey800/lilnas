import { Inject, Injectable } from '@nestjs/common'
import { Client } from 'discord.js'
import { Context, SlashCommand, type SlashCommandContext } from 'necord'
import { PinoLogger } from 'nestjs-pino'

import { isThreadChannel } from 'src/discord/fetch-channel'
import { LOG_EVENTS } from 'src/logging/log-events'

import { ContextUsageService } from './context-usage.service'

@Injectable()
export class ContextCommandService {
  constructor(
    @Inject(Client) private readonly client: Client,
    private readonly contextUsage: ContextUsageService,
    private readonly logger: PinoLogger,
  ) {}

  @SlashCommand({
    name: 'context',
    description: "Show this channel's current context window usage.",
  })
  async onContext(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    const channelId = interaction.channelId
    this.logger.info(
      { event: LOG_EVENTS.contextCommandInvoked, channelId },
      '/context invoked',
    )

    // Context usage is a per-thread concept (each thread is its own agent
    // session) — running this outside a thread has no meaningful usage to
    // report.
    if (!(await isThreadChannel(this.client, channelId))) {
      this.logger.info(
        { event: LOG_EVENTS.contextCommandRejectedNotThread, channelId },
        '/context rejected — not a thread',
      )
      await interaction.reply('⚠️ `/context` can only be used inside a thread.')
      return
    }

    const usage = this.contextUsage.getUsage(channelId)
    if (!usage || usage.size <= 0) {
      await interaction.reply(
        'No context usage recorded yet for this channel — @mention the bot to start a session.',
      )
      return
    }

    const pct = Math.floor((usage.used / usage.size) * 100)
    await interaction.reply(
      `📊 Context usage: ${usage.used.toLocaleString()}/${usage.size.toLocaleString()} tokens (~${pct}%).`,
    )
  }
}
