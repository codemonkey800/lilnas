import { Module } from '@nestjs/common'
import { NestMinioModule } from 'nestjs-minio'
import { LoggerModule } from 'nestjs-pino'

import { EquationsController } from './equations.controller'
import { env } from './utils/env'

@Module({
  imports: [
    LoggerModule.forRoot(),
    NestMinioModule.register({
      accessKey: env('MINIO_ACCESS_KEY'),
      endPoint: env('MINIO_HOST'),
      isGlobal: true,
      port: +env('MINIO_PORT'),
      secretKey: env('MINIO_SECRET_KEY'),
      useSSL: false,
    }),
  ],
  controllers: [EquationsController],
})
export class AppModule {}
