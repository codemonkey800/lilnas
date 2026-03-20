import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'
import { MediaModule } from 'src/media/media.module'

import { ShowsController } from './shows.controller'
import { ShowsService } from './shows.service'

@Module({
  imports: [MediaModule, AuthModule],
  controllers: [ShowsController],
  providers: [ShowsService],
})
export class ShowsModule {}
