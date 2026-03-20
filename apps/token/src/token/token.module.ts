import { Module } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'

import { TokenController } from './token.controller'
import { TokenService } from './token.service'
import { TokenMetricsService } from './token-metrics.service'

@Module({
  imports: [DrizzleModule],
  controllers: [TokenController],
  providers: [TokenService, TokenMetricsService],
  exports: [TokenService],
})
export class TokenModule {}
