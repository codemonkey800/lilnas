import { forwardRef, Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'
import { DownloadGatewayModule } from 'src/download-gateway/download-gateway.module'
import { MediaModule } from 'src/media/media.module'

import { DownloadController } from './download.controller'
import { DownloadService } from './download.service'
import { DownloadMetricsService } from './download-metrics.service'
import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'
import { DownloadVideoService } from './download-video.service'

// MediaModule needs DownloadStateService (for MediaPollerService and
// MediaDownloadService) and this module needs MediaModule's
// MediaDownloadService (for DownloadController's movie/show endpoints) -
// see media.module.ts for the forwardRef() on the other side of this cycle.
// DownloadGatewayModule and AuthModule have no dependency back on this
// module, so both are plain imports - DownloadStateService injects
// DownloadGatewayModule's exported DownloadGateway to broadcast job
// creates/updates, and DownloadController injects AuthModule's
// AdminCheckService to resolve viewer admin status for attribution.
@Module({
  imports: [AuthModule, DownloadGatewayModule, forwardRef(() => MediaModule)],
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
