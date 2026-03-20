import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'
import { MediaModule } from 'src/media/media.module'

import { MoviesController } from './movies.controller'
import { MoviesService } from './movies.service'

@Module({
  imports: [MediaModule, AuthModule],
  controllers: [MoviesController],
  providers: [MoviesService],
})
export class MoviesModule {}
