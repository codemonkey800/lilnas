import { Module } from '@nestjs/common'

import { TokenModule } from 'src/token/token.module'

import { PublicController } from './public.controller'

@Module({
  imports: [TokenModule],
  controllers: [PublicController],
})
export class PublicModule {}
