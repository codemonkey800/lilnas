import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { DownloadService } from './download.service'
import { type DownloadRequest, downloadRequestSchema } from './download.types'

/**
 * Validates and narrows a raw request body into a typed {@link DownloadRequest}.
 * Throws {@link BadRequestException} for any missing or invalid fields.
 */
function validateRequest(body: unknown): DownloadRequest {
  const result = downloadRequestSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues[0]?.message ?? 'Invalid request body',
    )
  }
  return result.data
}

@Controller('downloads')
@UseGuards(JwtAuthGuard)
export class DownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  /**
   * POST /downloads — Accepts a download request for a movie or show and
   * returns immediately with 202 Accepted. Progress is streamed via WebSocket.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestDownload(@Body() body: unknown): Promise<{ ok: true }> {
    const req = validateRequest(body)
    await this.downloadService.requestDownload(req)
    return { ok: true }
  }
}
