// Added so ForwardedUserGuard, @CurrentUser(), and AdminCheckService each
// have one real, curl-testable HTTP path, without waiting for Phase 1 to
// wire any of this into DownloadController. Safe to delete once Phase 1
// lands real wiring, or keep permanently as an operational "am I
// authenticated, am I an admin" diagnostic.
import { Controller, Get, UseGuards } from '@nestjs/common'

import { AdminCheckService } from './admin-check.service'
import { CurrentUser } from './current-user.decorator'
import type { ForwardedUser } from './forwarded-user'
import { ForwardedUserGuard } from './forwarded-user.guard'

interface WhoamiResponse extends ForwardedUser {
  isAdmin: boolean
}

@Controller('auth')
export class AuthDebugController {
  constructor(private readonly adminCheckService: AdminCheckService) {}

  @Get('whoami')
  @UseGuards(ForwardedUserGuard)
  async whoami(@CurrentUser() user: ForwardedUser): Promise<WhoamiResponse> {
    const isAdmin = await this.adminCheckService.checkIsAdmin(user.email)
    return { ...user, isAdmin }
  }
}
