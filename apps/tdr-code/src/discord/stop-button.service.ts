import { Injectable } from '@nestjs/common'
import { MessageFlags } from 'discord.js'
import { Button, type ButtonContext, ComponentParam, Context } from 'necord'

import { SessionManagerService } from 'src/agent/session-manager.service'

@Injectable()
export class StopButtonService {
  constructor(private readonly sessionManager: SessionManagerService) {}

  @Button('stop/:channelId/:turnId')
  async onStop(
    @Context() [interaction]: ButtonContext,
    @ComponentParam('channelId') rawChannelId: string,
    @ComponentParam('turnId') rawTurnId: string,
  ): Promise<void> {
    const turnId = Number(rawTurnId)

    // Validate parsed values before acting — malformed ids must never cancel
    if (!Number.isInteger(turnId)) {
      await interaction
        .reply({
          content: 'Invalid Stop button.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
      return
    }

    if (rawChannelId !== interaction.channelId) {
      await interaction
        .reply({
          content: 'Channel mismatch.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
      return
    }

    const cancelled = this.sessionManager.cancel(rawChannelId, turnId)

    if (cancelled) {
      // Working message will be edited to "⏹ Stopped" via onPromptComplete
      await interaction.deferUpdate().catch(() => {})
    } else {
      await interaction
        .reply({
          content: 'That turn already ended.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
    }
  }
}
