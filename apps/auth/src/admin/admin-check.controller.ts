import { env } from '@lilnas/utils/env'
import { Controller, Get, Query, UseGuards } from '@nestjs/common'

import { EnvKeys } from 'src/env'
import {
  InternalTokenGuard,
  RequireInternalScope,
} from 'src/internal/internal-token.guard'

import { isAdminEmail } from './admin.guard'

export interface AdminCheckResponse {
  isAdmin: boolean
}

// Not on AdminController, which is @UseGuards(AdminGuard) at the class level
// and requires a live session cookie. This answers "is this email an admin"
// STATELESSLY, for server-to-server callers with no session of their own
// (apps/download's AdminCheckService, apps/icloud-backup).
//
// Reachability: port 8081 (where every one of this app's Nest routes lives)
// has no Traefik router and publishes no port, so only containers on the
// shared Docker network reach it. That network is not the only control any
// more: InternalTokenGuard identifies the caller by its bearer token and
// requires the `admin-check` scope (src/internal/internal-callers.ts). It
// rejects only when INTERNAL_TOKEN_ENFORCE=true; otherwise it allows and logs.
//
// Registered flat in app.module.ts's `controllers` array, matching
// MeController's own no-per-feature-module convention.
@UseGuards(InternalTokenGuard)
@Controller('admin')
export class AdminCheckController {
  @Get('check')
  @RequireInternalScope('admin-check')
  check(@Query('email') email?: string): AdminCheckResponse {
    return {
      isAdmin: email ? isAdminEmail(email, env(EnvKeys.ADMIN_EMAILS)) : false,
    }
  }
}
