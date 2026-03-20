import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'
import { MediaModule } from 'src/media/media.module'

import { DownloadGateway } from './download.gateway'
import { DownloadPollerService } from './download-poller.service'
import { DownloadsController } from './downloads.controller'
import { DownloadsService } from './downloads.service'

@Module({
  imports: [MediaModule, AuthModule],
  controllers: [DownloadsController],
  providers: [DownloadsService, DownloadGateway, DownloadPollerService],
})
export class DownloadsModule {}
