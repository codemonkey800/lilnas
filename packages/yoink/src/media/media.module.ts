import { Module } from '@nestjs/common'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { LibraryController } from './library.controller'
import { LibraryService } from './library.service'
import { MoviesController } from './movies.controller'
import { MoviesService } from './movies.service'
import { ShowsController } from './shows.controller'
import { ShowsService } from './shows.service'
import { StorageController } from './storage.controller'
import { StorageService } from './storage.service'

@Module({
  controllers: [
    MoviesController,
    ShowsController,
    LibraryController,
    StorageController,
  ],
  providers: [
    MoviesService,
    ShowsService,
    LibraryService,
    StorageService,
    JwtAuthGuard,
  ],
})
export class MediaModule {}
