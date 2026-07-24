import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'

import { EmbyController } from './emby.controller'
import { EmbyService } from './emby.service'

@Module({
  imports: [AuthModule],
  controllers: [EmbyController],
  providers: [EmbyService],
})
export class EmbyModule {}
