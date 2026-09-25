import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { AuditModule } from 'src/audit/audit.module'
import { DownloadModule } from 'src/download/download.module'

import { YtdlpUpdateController } from './ytdlp-update.controller'
import { YtdlpUpdateService } from './ytdlp-update.service'

@Module({
  imports: [ScheduleModule.forRoot(), DownloadModule, AuditModule],
  controllers: [YtdlpUpdateController],
  providers: [YtdlpUpdateService],
  exports: [YtdlpUpdateService],
})
export class YtdlpUpdateModule {}
