import { Module } from '@nestjs/common'

import { LogParser } from './log-parser'
import { ProcessService } from './process.service'
import { WebuiClient } from './webui.client'

@Module({
  providers: [ProcessService, WebuiClient, LogParser],
  exports: [ProcessService, WebuiClient, LogParser],
})
export class IcloudpdModule {}
