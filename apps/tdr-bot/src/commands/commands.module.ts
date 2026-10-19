import { Module } from '@nestjs/common'

import { EmojiDictionaryModule } from 'src/emojis/emoji-dictionary.module'
import { LlmCoreModule } from 'src/llm/llm-core.module'
import { PromptsModule } from 'src/messages/prompts/prompts.module'
import { ServicesModule } from 'src/services/services.module'

import { CommandsService } from './command.service'
import { DownloadCommandService } from './download-command.service'
import { TldrService } from './tldr/tldr.service'
import { TldrCommandService } from './tldr/tldr-command.service'
import { TldrWindowService } from './tldr/window.service'

@Module({
  imports: [
    ServicesModule,
    LlmCoreModule,
    PromptsModule,
    EmojiDictionaryModule,
  ],
  providers: [
    CommandsService,
    DownloadCommandService,
    TldrWindowService,
    TldrService,
    TldrCommandService,
  ],
})
export class CommandsModule {}
