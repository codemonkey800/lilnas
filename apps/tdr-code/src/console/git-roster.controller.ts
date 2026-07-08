import { Controller, Get } from '@nestjs/common'

import { GitRosterService } from './git-roster.service'

// Read-only (R3) — no requireSameOrigin() check, matching every other GET in
// this codebase's console controllers (see git-identity.controller.ts's own
// GET routes). Still behind the global AuthGuard (no @Public()).
@Controller('git/roster')
export class GitRosterController {
  constructor(private readonly service: GitRosterService) {}

  @Get()
  listRoster() {
    return this.service.listRoster()
  }
}
