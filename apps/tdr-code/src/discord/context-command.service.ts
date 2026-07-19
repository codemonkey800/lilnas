import { Injectable } from '@nestjs/common'
import { Context, SlashCommand, type SlashCommandContext } from 'necord'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'

import { ContextUsageService } from './context-usage.service'

@Injectable()
export class ContextCommandService {
  constructor(
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
