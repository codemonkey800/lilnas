import { Controller, Get } from '@nestjs/common'

import type { BotStatusDto } from './bot-status.dto'
import { BotStatusService } from './bot-status.service'

// Trust boundary: Traefik forward-auth guards the public internet path.
// Any container on the lilnas-proxy Docker network can reach port 8082
// directly. Phase D will add NestJS-level auth (see plan). Until then,
// /bot/status exposes only non-sensitive lifecycle state.
@Controller('bot')
export class BotStatusController {
  constructor(private readonly botStatusService: BotStatusService) {}

  @Get('status')
  getStatus(): BotStatusDto {
    return this.botStatusService.getStatus()
  }
}
