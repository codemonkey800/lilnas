import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
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
    NestMinioModule.register({
      accessKey: env(EnvKeys.MINIO_ACCESS_KEY),
      endPoint: env(EnvKeys.MINIO_HOST),
      isGlobal: true,
      port: +env(EnvKeys.MINIO_PORT),
      secretKey: env(EnvKeys.MINIO_SECRET_KEY),
      useSSL: false,
    }),
  ],
})
export class AppModule {}
