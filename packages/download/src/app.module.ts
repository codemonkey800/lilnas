import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { NestMinioModule } from 'nestjs-minio'
import { LoggerModule } from 'nestjs-pino'

import { DownloadModule } from './download/download.module'
import { EnvKey } from './utils/env'
import { YtdlpUpdateModule } from './ytdlp-update/ytdlp-update.module'

@Module({
  imports: [
    DownloadModule,
    YtdlpUpdateModule,
    LoggerModule.forRoot(),
    NestMinioModule.register({
      accessKey: env<EnvKey>('MINIO_ACCESS_KEY'),
      endPoint: env<EnvKey>('MINIO_HOST'),
      isGlobal: true,
      port: +env<EnvKey>('MINIO_PORT'),
      secretKey: env<EnvKey>('MINIO_SECRET_KEY'),
      useSSL: false,
    }),
  ],
})
export class AppModule {}
