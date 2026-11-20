import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { LoggerModule } from 'nestjs-pino'

import { AdminModule } from './admin/admin.module'
import { ApiModule } from './api/api.module'
import { AuthModule } from './auth/auth.module'
import { DbModule } from './db/db.module'
import { HealthModule } from './health/health.module'
import { IcloudpdModule } from './icloudpd/icloudpd.module'
import { ImmichModule } from './immich/immich.module'
import { JobsModule } from './jobs/jobs.module'
import { pinoHttpOptions } from './logger.config'

@Module({
  imports: [
    HealthModule,
    AuthModule,
    DbModule,
    IcloudpdModule,
    ImmichModule,
    JobsModule,
    ApiModule,
    AdminModule,
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions }),
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
