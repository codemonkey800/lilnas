import { Module } from '@nestjs/common'

import { AdminGuard } from './admin.guard'
import { AdminCheckService } from './admin-check.service'
import { AttributionResolutionService } from './attribution-resolution.service'
import { AuthDebugController } from './auth-debug.controller'
import { DiscordLinkService } from './discord-link.service'
import { ForwardedUserGuard } from './forwarded-user.guard'

@Module({
  controllers: [AuthDebugController],
  providers: [
    ForwardedUserGuard,
    AdminCheckService,
    AdminGuard,
    AttributionResolutionService,
    DiscordLinkService,
  ],
  exports: [
    ForwardedUserGuard,
    AdminCheckService,
    AdminGuard,
    AttributionResolutionService,
    DiscordLinkService,
  ],
})
export class AuthModule {}
