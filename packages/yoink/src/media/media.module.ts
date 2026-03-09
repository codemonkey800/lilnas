import { Module } from '@nestjs/common'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { LibraryController } from './library.controller'
import { LibraryService } from './library.service'
import { MoviesController } from './movies.controller'
import { MoviesService } from './movies.service'
import { ShowsController } from './shows.controller'
import { ShowsService } from './shows.service'

@Module({
  controllers: [MoviesController, ShowsController, LibraryController],
  providers: [MoviesService, ShowsService, LibraryService, JwtAuthGuard],
})
export class MediaModule {}
