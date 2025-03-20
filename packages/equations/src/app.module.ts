import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { EquationsController } from './equations.controller'

@Module({
  imports: [LoggerModule.forRoot()],
  controllers: [EquationsController],
})
export class AppModule {}
