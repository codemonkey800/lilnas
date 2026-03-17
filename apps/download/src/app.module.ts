import { env } from '@lilnas/utils/env'
import { MetricsInterceptor } from '@lilnas/utils/metrics-interceptor'
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { NestMinioModule } from 'nestjs-minio'
import { LoggerModule } from 'nestjs-pino'

import { DownloadModule } from './download/download.module'
import { EnvKeys } from './env'
import { YtdlpUpdateModule } from './ytdlp-update/ytdlp-update.module'

@Module({
  imports: [
    DownloadModule,
    YtdlpUpdateModule,
    LoggerModule.forRoot(),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    NestMinioModule.register({
      accessKey: env(EnvKeys.MINIO_ACCESS_KEY),
      endPoint: env(EnvKeys.MINIO_HOST),
      isGlobal: true,
      port: +env(EnvKeys.MINIO_PORT),
      secretKey: env(EnvKeys.MINIO_SECRET_KEY),
      useSSL: false,
    }),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
