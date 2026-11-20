import { Controller, Get } from '@nestjs/common'

import { Public } from 'src/auth/public.decorator'

// The only unguarded route: the compose healthcheck calls it without headers.
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' }
  }
}
