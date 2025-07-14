import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { NestMinioModule } from 'nestjs-minio'
import { LoggerModule } from 'nestjs-pino'

import { EquationsController } from './equations.controller'
import { HealthController } from './health.controller'
import { EnvKey } from './utils/env'

@Module({
  imports: [
    LoggerModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minute
        limit: 5, // 5 requests per minute
      },
      {
        name: 'medium',
        ttl: 900000, // 15 minutes
        limit: 20, // 20 requests per 15 minutes
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hour
        limit: 50, // 50 requests per hour
      },
    ]),
    NestMinioModule.register({
      accessKey: env<EnvKey>('MINIO_ACCESS_KEY'),
      endPoint: env<EnvKey>('MINIO_HOST'),
      isGlobal: true,
      port: +env<EnvKey>('MINIO_PORT'),
      secretKey: env<EnvKey>('MINIO_SECRET_KEY'),
      useSSL: false,
    }),
  ],
  controllers: [EquationsController, HealthController],
})
export class AppModule {}
