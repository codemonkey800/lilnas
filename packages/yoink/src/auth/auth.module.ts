import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvKeys } from 'src/env'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { GoogleStrategy } from './google.strategy'
import { JwtAuthGuard } from './jwt-auth.guard'
import { ReturnToMiddleware } from './return-to.middleware'

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: () =>
        ({
          secret: process.env[EnvKeys.JWT_SECRET],
          signOptions: {
            expiresIn: process.env[EnvKeys.JWT_EXPIRATION] ?? '24h',
          },
        }) as JwtModuleOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ReturnToMiddleware)
      .forRoutes({ path: 'auth/google', method: RequestMethod.GET })
  }
}
