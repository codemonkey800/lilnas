import { Injectable } from '@nestjs/common'
import { MessageFlags } from 'discord.js'
import { Button, type ButtonContext, ComponentParam, Context } from 'necord'
import { PinoLogger } from 'nestjs-pino'

import { SessionManagerService } from 'src/agent/session-manager.service'
import { STOP_ID_PREFIX } from 'src/discord/stop-button-id'
import { LOG_EVENTS } from 'src/logging/log-events'

@Injectable()
export class StopButtonService {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly logger: PinoLogger,
  ) {}

  @Button(`${STOP_ID_PREFIX}/:channelId/:turnId`)
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
    this.logger.info(
      {
        event: LOG_EVENTS.stopButtonPressed,
        channelId: rawChannelId,
        turnId,
        cancelled,
      },
      'Stop button pressed',
    )

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
