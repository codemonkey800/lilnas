import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { HealthModule } from './health/health.module'

@Module({
  imports: [HealthModule, LoggerModule.forRoot()],
})
export class AppModule {}
