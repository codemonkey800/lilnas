import { Module } from '@nestjs/common'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import { SessionManagerService } from 'src/agent/session-manager.service'

import { DiscordHandlerService } from './discord-handler.service'
import { StopButtonService } from './stop-button.service'

@Module({
  providers: [
    DiscordHandlerService,
    {
      provide: ACP_EVENT_HANDLERS,
      useExisting: DiscordHandlerService,
    },
    SessionManagerService,
    StopButtonService,
  ],
})
export class DiscordModule {}
