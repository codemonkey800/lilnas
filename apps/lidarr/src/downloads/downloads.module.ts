import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'
import { MediaModule } from 'src/media/media.module'

import { DownloadGateway } from './download.gateway'
import { DownloadPollerService } from './download-poller.service'
import { DownloadStateService } from './download-state.service'
import { DownloadsController } from './downloads.controller'
import { DownloadsService } from './downloads.service'
import { MovieDownloaderService } from './movie-downloader.service'
import { ShowDownloaderService } from './show-downloader.service'

@Module({
  imports: [MediaModule, AuthModule],
  controllers: [DownloadsController],
  providers: [
    DownloadStateService,
    MovieDownloaderService,
    ShowDownloaderService,
    DownloadsService,
    DownloadGateway,
    DownloadPollerService,
  ],
})
export class DownloadsModule {}
