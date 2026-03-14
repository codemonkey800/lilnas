import { Module } from '@nestjs/common'

import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { EquationImageService } from './equation-image.service'

@Module({
  providers: [EquationImageService, RetryService, ErrorClassificationService],
  exports: [EquationImageService, RetryService, ErrorClassificationService],
})
export class ServicesModule {}
