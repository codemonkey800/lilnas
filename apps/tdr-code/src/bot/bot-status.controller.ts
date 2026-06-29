import { Controller, Get } from '@nestjs/common'

import type { BotStatusDto } from './bot-status.dto'
import { BotStatusService } from './bot-status.service'

@Controller('bot')
export class BotStatusController {
  constructor(private readonly botStatusService: BotStatusService) {}

  @Get('status')
  getStatus(): BotStatusDto {
    return this.botStatusService.getStatus()
  }
}
