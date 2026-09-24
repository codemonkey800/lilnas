import { env } from '@lilnas/utils/env'
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common'
import { Client } from 'discord.js'

import { EnvKeys } from 'src/env'

import { formatGrafanaAlerts } from './grafana-alert.formatter'
import { GrafanaWebhookGuard } from './grafana-webhook.guard'
import type { GrafanaWebhookPayload } from './grafana-webhook.types'

export interface GrafanaWebhookResponse {
  /** Number of alert embeds posted to Discord. */
  sent: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Receives Grafana unified-alerting webhook notifications and posts them to
 * the `ALERTS_CHANNEL_ID` Discord channel as the bot.
 *
 * Once a request is authenticated the endpoint always answers 202: Grafana
 * retries non-2xx responses, so a Discord-side failure (missing channel,
 * send error) is logged rather than surfaced, to avoid a retry storm that
 * can't succeed anyway.
 */
@Controller('alerts')
@UseGuards(GrafanaWebhookGuard)
export class GrafanaAlertsController {
  private readonly logger = new Logger(GrafanaAlertsController.name)

  constructor(private readonly client: Client) {}

  @Post('grafana')
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(@Body() body: unknown): Promise<GrafanaWebhookResponse> {
    const payload: GrafanaWebhookPayload =
      body && typeof body === 'object' && !Array.isArray(body) ? body : {}

    const { batches } = formatGrafanaAlerts(payload)

    if (batches.length === 0) {
      this.logger.debug('Grafana webhook had no alerts; nothing to post')

      return { sent: 0 }
    }

    const channel = await this.resolveChannel()

    if (!channel) return { sent: 0 }

    let sent = 0

    for (const embeds of batches) {
      try {
        // Alert text is externally sourced; never let it ping anyone.
        await channel.send({ embeds, allowedMentions: { parse: [] } })
        sent += embeds.length
      } catch (error) {
        this.logger.error(
          `Failed to post ${embeds.length} Grafana alert embed(s) to Discord: ${errorMessage(error)}`,
        )
      }
    }

    this.logger.log(
      `Posted ${sent} Grafana alert(s) (status: ${payload.status ?? 'unknown'})`,
    )

    return { sent }
  }

  private async resolveChannel() {
    const channelId = env(EnvKeys.ALERTS_CHANNEL_ID, '')

    if (!channelId) {
      this.logger.error('ALERTS_CHANNEL_ID is not set; dropping Grafana alert')

      return undefined
    }

    try {
      const channel = await this.client.channels.fetch(channelId)

      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        this.logger.error(
          `Alerts channel ${channelId} not found or not text-based; dropping Grafana alert`,
        )

        return undefined
      }

      return channel
    } catch (error) {
      this.logger.error(
        `Failed to fetch alerts channel ${channelId}: ${errorMessage(error)}`,
      )

      return undefined
    }
  }
}
