import { Module } from '@nestjs/common'

import { CommandsService } from './command.service'
import { DownloadCommandService } from './download-command.service'

@Module({
  providers: [CommandsService, DownloadCommandService],
})
export class CommandsModule {}
