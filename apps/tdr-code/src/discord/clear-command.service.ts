import { Injectable } from '@nestjs/common'
import { Context, SlashCommand, type SlashCommandContext } from 'necord'

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
    description:
      'Force-stop the agent and reset this channel to a clean slate.',
  })
  async onClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const channelId = interaction.channelId

    // Order matters: resetChannel deletes channelStates + arms the cleared-channel
    // guard BEFORE teardown fires the synchronous onPromptComplete('aborted'), so
    // the abort finds no state and cannot flush a partial reply (Decision #5).
    this.discordHandler.resetChannel(channelId)
    this.sessionManager.teardown(channelId)

    await interaction.reply('Session cleared — next @mention starts fresh.')
  }
}
