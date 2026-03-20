import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { LoggerModule } from 'nestjs-pino'

import { AuthModule } from './auth/auth.module'
import { DownloadsModule } from './downloads/downloads.module'
import { HealthController } from './health/health.controller'
import { MediaModule } from './media/media.module'
import { MoviesModule } from './movies/movies.module'
import { ShowsModule } from './shows/shows.module'

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    AuthModule,
    MediaModule,
    MoviesModule,
    ShowsModule,
    DownloadsModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        ...(process.env.NODE_ENV !== 'production' && {
          transport: { target: 'pino-pretty' },
        }),
        redact: ['req.headers["x-token-value"]'],
      },
    }),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
