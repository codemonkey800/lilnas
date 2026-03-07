import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { LoggerModule } from 'nestjs-pino'

import { AuthModule } from './auth/auth.module'
import { DownloadModule } from './download/download.module'
import { HealthModule } from './health/health.module'
import { MediaModule } from './media/media.module'

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    AuthModule,
    HealthModule,
    MediaModule,
    DownloadModule,
    LoggerModule.forRoot(),
  ],
})
export class AppModule {}
