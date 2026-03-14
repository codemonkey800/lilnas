import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { NestMinioModule } from 'nestjs-minio'
import { LoggerModule } from 'nestjs-pino'

import { EnvKeys } from './env'
import { EquationsController } from './equations.controller'
import { HealthController } from './health.controller'

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
      accessKey: env(EnvKeys.MINIO_ACCESS_KEY),
      endPoint: env(EnvKeys.MINIO_HOST),
      isGlobal: true,
      port: +env(EnvKeys.MINIO_PORT),
      secretKey: env(EnvKeys.MINIO_SECRET_KEY),
      useSSL: false,
    }),
  ],
  controllers: [EquationsController, HealthController],
})
export class AppModule {}
