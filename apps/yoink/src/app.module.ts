import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { LoggerModule } from 'nestjs-pino'

import { AuthModule } from './auth/auth.module'
import { DownloadModule } from './download/download.module'
import { HealthModule } from './health/health.module'
import { MediaModule } from './media/media.module'
import { YoinkMetricsService } from './yoink-metrics.service'

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    AuthModule,
    HealthModule,
    MediaModule,
    DownloadModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        ...(process.env.NODE_ENV !== 'production' && {
          transport: { target: 'pino-pretty' },
        }),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    YoinkMetricsService,
  ],
  exports: [YoinkMetricsService],
})
export class AppModule {}
