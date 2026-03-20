import { env } from '@lilnas/utils/env'
import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { LoggerModule } from 'nestjs-pino'

import { AppsModule } from './apps/apps.module'
import { EnvKeys } from './env'
import { HealthModule } from './health/health.module'
import { PublicModule } from './public/public.module'
import { TokenModule } from './token/token.module'

@Module({
  imports: [
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    LoggerModule.forRoot(
      (() => {
        const isProduction =
          env(EnvKeys.NODE_ENV, 'development') === 'production'
        const logFilePath = env(EnvKeys.LOG_FILE_PATH, '')

        if (isProduction) {
          return {
            pinoHttp: { level: 'info' },
          }
        }

        if (logFilePath) {
          return {
            pinoHttp: {
              transport: {
                targets: [
                  { target: 'pino-pretty', options: { destination: 1 } },
                  {
                    target: 'pino-pretty',
                    options: { destination: logFilePath, mkdir: true },
                  },
                ],
              },
              level: 'debug',
            },
          }
        }

        return {
          pinoHttp: {
            transport: { target: 'pino-pretty' },
            level: 'debug',
          },
        }
      })(),
    ),
    AppsModule,
    TokenModule,
    PublicModule,
    HealthModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
