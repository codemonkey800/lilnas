import { Module } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { EquationImageService } from './equation-image.service'

@Module({
  providers: [
    EquationImageService,
    RetryService,
    ErrorClassificationService,
    RetryConfigService,
  ],
  exports: [
    EquationImageService,
    RetryService,
    ErrorClassificationService,
    RetryConfigService,
  ],
})
export class ServicesModule {}
