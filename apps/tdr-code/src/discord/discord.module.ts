import { Module } from '@nestjs/common'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { CommandPollerService } from 'src/commands/command-poller.service'

import { BotLifecycleService } from './bot-lifecycle.service'
import { ClearCommandService } from './clear-command.service'
import { DiscordHandlerService } from './discord-handler.service'
import { StopButtonService } from './stop-button.service'

@Module({
  providers: [
    BotLifecycleService,
    CommandPollerService,
    DiscordHandlerService,
    {
      provide: ACP_EVENT_HANDLERS,
      useExisting: DiscordHandlerService,
    },
    SessionManagerService,
    StopButtonService,
    ClearCommandService,
  ],
})
export class DiscordModule {}
