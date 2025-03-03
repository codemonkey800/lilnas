import { Module } from '@nestjs/common'

import { EquationImageService } from './equation-image.service'

@Module({
  providers: [EquationImageService],
  exports: [EquationImageService],
})
export class ServicesModule {}
