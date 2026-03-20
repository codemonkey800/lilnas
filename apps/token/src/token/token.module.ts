import { Module } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'

import { TokenController } from './token.controller'
import { TokenService } from './token.service'

@Module({
  imports: [DrizzleModule],
  controllers: [TokenController],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
