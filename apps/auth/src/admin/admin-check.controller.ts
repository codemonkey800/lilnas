import { env } from '@lilnas/utils/env'
import { Controller, Get, Query } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import { isAdminEmail } from './admin.guard'

export interface AdminCheckResponse {
  isAdmin: boolean
}

// Guard-free by design — cannot hang off AdminController, which is
// @UseGuards(AdminGuard) at the class level and requires a live session
// cookie. This answers "is this email an admin" STATELESSLY, for
// server-to-server callers with no session/cookie of their own (starting
// with apps/download's AdminCheckService).
//
// Reachability: port 8081 (where every one of this app's Nest routes
// lives) has no Traefik router at all — confirmed, it's reached only via
// forwardauth.address=http://auth:8081/verify and other container-to-
// container callers. This route is therefore reachable, ungated, by ANY
// container on the shared lilnas-proxy network — exactly like
// VerifyController's own /verify. Accepted precedent, not a new risk
// category: apps/tdr-code/src/bot/bot-status.controller.ts documents the
// identical trust boundary for its own unauthenticated status route.
//
// Registered flat in app.module.ts's `controllers` array, matching
// MeController's own no-per-feature-module convention.
@Controller('admin')
export class AdminCheckController {
  @Get('check')
  check(@Query('email') email?: string): AdminCheckResponse {
    return {
      isAdmin: email ? isAdminEmail(email, env(EnvKeys.ADMIN_EMAILS)) : false,
    }
  }
}
