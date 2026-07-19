import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { LoggerModule } from 'nestjs-pino'

import { HealthModule } from './health/health.module'

@Module({
  imports: [
    HealthModule,
    LoggerModule.forRoot(),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
