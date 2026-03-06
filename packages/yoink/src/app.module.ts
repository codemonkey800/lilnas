import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { AuthModule } from './auth/auth.module'
import { HealthModule } from './health/health.module'

@Module({
  imports: [AuthModule, HealthModule, LoggerModule.forRoot()],
})
export class AppModule {}
