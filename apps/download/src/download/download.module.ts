import { forwardRef, Module } from '@nestjs/common'

import { AuditModule } from 'src/audit/audit.module'
import { AuthModule } from 'src/auth/auth.module'
import { DownloadGatewayModule } from 'src/download-gateway/download-gateway.module'
import { MediaModule } from 'src/media/media.module'

import { DownloadController } from './download.controller'
import { DownloadService } from './download.service'
import { DownloadMetricsService } from './download-metrics.service'
import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'
import { DownloadVideoService } from './download-video.service'
import { JobQueryService } from './job-query.service'

// MediaModule needs DownloadStateService (for MediaPollerService and
// MediaDownloadService) and this module needs MediaModule's
// MediaDownloadService (for DownloadController's movie/show endpoints) -
// see media.module.ts for the forwardRef() on the other side of this cycle.
// AuditModule, DownloadGatewayModule and AuthModule have no dependency back
// on this module, so all three are plain imports - DownloadStateService
// injects DownloadGatewayModule's exported DownloadGateway to broadcast job
// creates/updates, DownloadController injects AuthModule's AdminCheckService
// to resolve viewer admin status for attribution, and it injects
// AuditModule's AuditLogService to append a row for every mutating route it
// serves.
@Module({
  imports: [
    AuditModule,
    AuthModule,
    DownloadGatewayModule,
    forwardRef(() => MediaModule),
  ],
  providers: [
    DownloadMetricsService,
    DownloadSchedulerService,
    DownloadService,
    DownloadStateService,
    DownloadVideoService,
    JobQueryService,
  ],
  controllers: [DownloadController],
  exports: [DownloadMetricsService, DownloadStateService, JobQueryService],
})
export class DownloadModule {}
