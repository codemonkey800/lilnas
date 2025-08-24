import { Module } from '@nestjs/common'

import { MediaModule } from 'src/media/media.module'
import { DiscordComponentsModule } from 'src/media/services/discord-components.module'

import { CommandsService } from './command.service'
import { DownloadCommandService } from './download-command.service'
import { MediaSearchInteractionHandler } from './handlers/media-search-interaction.handler'
import { MediaSearchCommandService } from './media-search-command.service'

@Module({
  imports: [MediaModule, DiscordComponentsModule],
  providers: [
    CommandsService,
    DownloadCommandService,
    MediaSearchCommandService,
    MediaSearchInteractionHandler,
  ],
  exports: [MediaSearchInteractionHandler],
})
export class CommandsModule {}
