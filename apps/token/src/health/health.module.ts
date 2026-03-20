import { Module } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'

import { HealthController } from './health.controller'

@Module({
  imports: [DrizzleModule],
  controllers: [HealthController],
})
export class HealthModule {}
