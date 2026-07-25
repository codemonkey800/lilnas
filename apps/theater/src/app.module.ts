import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { LoggerModule } from 'nestjs-pino'

import { AuthModule } from './auth/auth.module'
import { EmbyModule } from './emby/emby.module'
import { HealthModule } from './health/health.module'
import { PresenceModule } from './presence/presence.module'

@Module({
  imports: [
    AuthModule,
    EmbyModule,
    HealthModule,
    PresenceModule,
    LoggerModule.forRoot(),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 10, // 10 login attempts per minute per IP
      },
    ]),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
