import { Controller, Get } from '@nestjs/common'

import type { LiveResponseDto } from './live.dto'
import { LiveService } from './live.service'

// Trust boundary: see bot-status.controller.ts.
// Phase D (D6) must enumerate this route for deny-by-default guards.
@Controller('live')
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @Get()
  getLive(): Promise<LiveResponseDto> {
    return this.liveService.getLive()
  }
}
