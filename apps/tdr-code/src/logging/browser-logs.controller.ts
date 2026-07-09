import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common'

import { BrowserLogEntrySchema } from './browser-logs.dto'
import { BrowserLogsService } from './browser-logs.service'

// Same defense-in-depth origin check as config/git-identity/lifecycle/
// auth-admin — this is a mutating route, so it needs the same CSRF backstop
// alongside the session cookie (sameSite: 'lax').
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function requireSameOrigin(origin: string | undefined): void {
  if (origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('cross-origin request rejected')
  }
}

// Guarded (not @Public()) — see src/auth/protected-routes.ts's own header
// comment on why PUBLIC_ROUTES stays a minimal, tested allowlist. This means
// browser errors on unauthenticated pages (chiefly /login) go uncaptured;
// every authenticated page is covered. Trust boundary: Phase D (D6) must
// enumerate this route for deny-by-default guards (see protected-routes.ts).
@Controller('logs')
export class BrowserLogsController {
  constructor(private readonly service: BrowserLogsService) {}

  @Post('browser')
  @HttpCode(204)
  logBrowserEvent(
    @Headers('origin') origin: string | undefined,
    @Body() body: unknown,
  ) {
    requireSameOrigin(origin)

    const parsed = BrowserLogEntrySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid browser log entry',
      )
    }

    this.service.write(parsed.data)
  }
}
