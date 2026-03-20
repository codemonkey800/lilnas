import { Module } from '@nestjs/common'

import { TokenModule } from 'src/token/token.module'

import { AppsController } from './apps.controller'
import { AppsService } from './apps.service'

@Module({
  imports: [TokenModule],
  controllers: [AppsController],
  providers: [AppsService],
})
export class AppsModule {}
