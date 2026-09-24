import { env } from '@lilnas/utils/env'
import { Logger, Module, OnModuleInit } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import { GrafanaAlertsController } from './grafana-alerts.controller'
import { GrafanaWebhookGuard } from './grafana-webhook.guard'

/**
 * Grafana alert webhook → Discord. Relies on the discord.js `Client` that
 * `NecordModule.forRoot` provides globally.
 */
@Module({
  controllers: [GrafanaAlertsController],
  providers: [GrafanaWebhookGuard],
})
export class AlertsModule implements OnModuleInit {
  private readonly logger = new Logger(AlertsModule.name)

  onModuleInit() {
    if (!env(EnvKeys.GRAFANA_WEBHOOK_TOKEN, '')) {
      this.logger.warn(
        'GRAFANA_WEBHOOK_TOKEN is not set; POST /alerts/grafana will reject every request',
      )
    }

    if (!env(EnvKeys.ALERTS_CHANNEL_ID, '')) {
      this.logger.warn(
        'ALERTS_CHANNEL_ID is not set; Grafana alerts will be accepted but not posted',
      )
    }
  }
}
