import { Module } from '@nestjs/common'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { MoviesController } from './movies.controller'
import { MoviesService } from './movies.service'
import { ShowsController } from './shows.controller'
import { ShowsService } from './shows.service'

@Module({
  controllers: [MoviesController, ShowsController],
  providers: [MoviesService, ShowsService, JwtAuthGuard],
})
export class MediaModule {}
