import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { type ShowDetail } from './shows'
import { ShowsService } from './shows.service'

const numericIdSchema = z.coerce.number().int().positive()

@Controller('shows')
@UseGuards(JwtAuthGuard)
export class ShowsController {
  constructor(private readonly showsService: ShowsService) {}

  /** GET /shows/:tvdbId — Returns full show details including episodes, files, and queue state. */
  @Get(':tvdbId')
  async getShow(@Param('tvdbId') tvdbId: string): Promise<ShowDetail> {
    const result = numericIdSchema.safeParse(tvdbId)
    if (!result.success) {
      throw new BadRequestException('tvdbId must be a positive integer')
    }
    return this.showsService.getShow(result.data)
  }
}
