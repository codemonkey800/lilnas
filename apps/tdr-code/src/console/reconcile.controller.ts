import { BadRequestException, Controller, Get, Param } from '@nestjs/common'

import type {
  JsonlStatusResponseDto,
  ReconcileResponseDto,
} from './reconcile.dto'
import { ReconcileService } from './reconcile.service'

// Trust boundary: see bot-status.controller.ts.
// Phase D (D6) must enumerate these routes for deny-by-default guards.
// reconcile is the most sensitive route — egresses computed diff of raw agent content.
@Controller('sessions')
export class ReconcileController {
  constructor(private readonly reconcileService: ReconcileService) {}

  @Get(':id/jsonl-status')
  jsonlStatus(@Param('id') idStr: string): JsonlStatusResponseDto {
    const id = parseInt(idStr, 10)
    if (isNaN(id) || id <= 0) {
      throw new BadRequestException('Session id must be a positive integer')
    }
    return this.reconcileService.getJsonlStatus(id)
  }

  @Get(':id/reconcile')
  reconcile(@Param('id') idStr: string): ReconcileResponseDto {
    const id = parseInt(idStr, 10)
    if (isNaN(id) || id <= 0) {
      throw new BadRequestException('Session id must be a positive integer')
    }
    return this.reconcileService.reconcile(id)
  }
}
