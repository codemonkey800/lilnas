import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'

import { CommandsService } from './command.service'
import { DownloadCommandService } from './download-command.service'
import { MediaSearchCommandService } from './media-search-command.service'

@Module({
  imports: [MediaModule],
  providers: [
    CommandsService,
    DownloadCommandService,
    MediaSearchCommandService,
  ],
})
export class CommandsModule {}
