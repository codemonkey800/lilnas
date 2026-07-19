import { Injectable } from '@nestjs/common'
import { MessageFlags } from 'discord.js'
import { Button, type ButtonContext, ComponentParam, Context } from 'necord'
import { PinoLogger } from 'nestjs-pino'

import type { PlanApprovalDecision } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { PLAN_APPROVAL_ID_PREFIX } from 'src/discord/plan-approval-button-id'
import { LOG_EVENTS } from 'src/logging/log-events'

@Injectable()
export class PlanApprovalButtonService {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly logger: PinoLogger,
  ) {}

  @Button(`${PLAN_APPROVAL_ID_PREFIX}/:channelId/:toolCallId/:decision`)
  async onDecision(
    @Context() [interaction]: ButtonContext,
    @ComponentParam('channelId') rawChannelId: string,
    @ComponentParam('toolCallId') toolCallId: string,
    @ComponentParam('decision') rawDecision: string,
  ): Promise<void> {
    if (rawDecision !== 'accept' && rawDecision !== 'reject') {
      await interaction
        .reply({
          content: 'Invalid plan-approval button.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
      return
    }
    const decision: PlanApprovalDecision = rawDecision

    if (rawChannelId !== interaction.channelId) {
      await interaction
        .reply({ content: 'Channel mismatch.', flags: MessageFlags.Ephemeral })
        .catch(() => {})
      return
    }

    // Resolving can take a few seconds when this settles via reactivation
    // (fresh process spawn + loadSession replay) rather than a still-live
    // permission request — defer immediately so we never miss Discord's
    // 3-second interaction-ack window. The actual message edit for a
    // successful resolution happens centrally via
    // SessionManagerService.resolvePlanApproval ->
    // PlanApprovalPresenter.settlePlanApprovalUi (fanned out to both Discord
    // and SQLite persistence by CompositeAcpHandler) rather than here — both
    // the live and reactivated paths render identically from that one path,
    // so there's nothing left for this handler to do on success.
    await interaction.deferUpdate().catch(() => {})

    const result = await this.sessionManager.resolvePlanApproval(
      rawChannelId,
      toolCallId,
      decision,
    )
    this.logger.info(
      {
        event: LOG_EVENTS.planApprovalButtonPressed,
        channelId: rawChannelId,
        toolCallId,
        decision,
        result,
      },
      'Plan-approval button pressed',
    )

    if (result === 'resolved_live' || result === 'resolved_reactivated') {
      return
    }

    if (result === 'stale') {
      // Self-heal: strip the buttons even though nothing here caused this
      // click to resolve, in case an earlier out-of-band settle
      // (session-manager.service.ts's settlePlanApprovalUi) failed to.
      await interaction.editReply({ components: [] }).catch(() => {})
      await interaction
        .followUp({
          content: 'This plan is no longer active.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
      return
    }

    // result === 'resume_failed' — the one case that isn't seamless: the
    // session genuinely couldn't be recreated, so say so honestly.
    await interaction
      .editReply({
        content: `${interaction.message.content}\n\n⚠️ Couldn't resume this conversation — please send a new message to continue.`,
        components: [],
      })
      .catch(() => {})
  }
}
