import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { DownloadModule } from 'src/download/download.module'

import { YtdlpUpdateController } from './ytdlp-update.controller'
import { YtdlpUpdateService } from './ytdlp-update.service'

@Module({
  imports: [ScheduleModule.forRoot(), DownloadModule],
  controllers: [YtdlpUpdateController],
  providers: [YtdlpUpdateService],
  exports: [YtdlpUpdateService],
})
export class YtdlpUpdateModule {}
