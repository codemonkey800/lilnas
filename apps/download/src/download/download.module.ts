import { Module } from '@nestjs/common'

import { DownloadController } from './download.controller'
import { DownloadService } from './download.service'
import { DownloadMetricsService } from './download-metrics.service'
import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'
import { DownloadVideoService } from './download-video.service'

@Module({
  providers: [
    DownloadMetricsService,
    DownloadSchedulerService,
    DownloadService,
    DownloadStateService,
    DownloadVideoService,
  ],
  controllers: [DownloadController],
  exports: [DownloadMetricsService, DownloadStateService],
})
export class DownloadModule {}
