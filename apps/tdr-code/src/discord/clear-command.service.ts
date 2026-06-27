import { Injectable } from '@nestjs/common'
import { Context, type SlashCommandContext, SlashCommand } from 'necord'

import { SessionManagerService } from 'src/agent/session-manager.service'

import { DiscordHandlerService } from './discord-handler.service'

@Injectable()
export class ClearCommandService {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly discordHandler: DiscordHandlerService,
  ) {}

  @SlashCommand({
    name: 'clear',
    description: 'Force-stop the agent and reset this channel to a clean slate.',
  })
  async onClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const channelId = interaction.channelId

    // Order matters: resetChannel deletes channelStates synchronously so the
    // killed process's error-path onPromptComplete finds no state (Decision #5).
    this.sessionManager.teardown(channelId)
    this.discordHandler.resetChannel(channelId)

    await interaction.reply(
      'Session cleared — next @mention starts fresh.',
    )
  }
}
