import { Module } from '@nestjs/common'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { DownloadController } from './download.controller'
import { DownloadGateway } from './download.gateway'
import { DownloadService } from './download.service'
import { DownloadPollerService } from './download-poller.service'

@Module({
  controllers: [DownloadController],
  providers: [
    DownloadService,
    DownloadGateway,
    DownloadPollerService,
    JwtAuthGuard,
  ],
  exports: [DownloadGateway],
})
export class DownloadModule {}
