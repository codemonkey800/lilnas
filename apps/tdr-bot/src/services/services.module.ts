import { Module } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { EquationImageService } from './equation-image.service'

@Module({
  providers: [
    EquationImageService,
    RetryService,
    ErrorClassificationService,
    RetryConfigService,
    TdrBotMetricsService,
  ],
  exports: [
    EquationImageService,
    RetryService,
    ErrorClassificationService,
    RetryConfigService,
    TdrBotMetricsService,
  ],
})
export class ServicesModule {}
