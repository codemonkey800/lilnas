import { Module } from '@nestjs/common'

import { ServicesModule } from 'src/services/services.module'

import { CommandsService } from './command.service'
import { DownloadCommandService } from './download-command.service'

@Module({
  imports: [ServicesModule],
  providers: [CommandsService, DownloadCommandService],
})
export class CommandsModule {}
