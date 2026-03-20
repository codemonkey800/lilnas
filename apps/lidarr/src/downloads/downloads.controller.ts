import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { TokenAuthGuard } from 'src/auth/token-auth.guard'

import { DownloadsService } from './downloads.service'
import {
  type AllDownloadsResponse,
  type DownloadRequest,
  downloadRequestSchema,
  type MovieDownloadStatusResponse,
  type ShowDownloadStatusResponse,
} from './downloads.types'

const numericIdSchema = z.coerce.number().int().positive()

function validateRequest(body: unknown): DownloadRequest {
  const result = downloadRequestSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues[0]?.message ?? 'Invalid request body',
    )
  }
  return result.data
}

function parseParam(value: string, name: string): number {
  const result = numericIdSchema.safeParse(value)
  if (!result.success) {
    throw new BadRequestException(`${name} must be a positive integer`)
  }
  return result.data
}

@Controller('downloads')
@UseGuards(TokenAuthGuard)
export class DownloadsController {
  constructor(private readonly downloadsService: DownloadsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestDownload(@Body() body: unknown): Promise<{ ok: true }> {
    const req = validateRequest(body)
    await this.downloadsService.requestDownload(req)
    return { ok: true }
  }

  @Get('movie/:tmdbId')
  async getMovieStatus(
    @Param('tmdbId') tmdbId: string,
  ): Promise<MovieDownloadStatusResponse | null> {
    const id = parseParam(tmdbId, 'tmdbId')
    return this.downloadsService.getMovieStatus(id)
  }

  @Get('show/:tvdbId')
  getShowStatus(@Param('tvdbId') tvdbId: string): ShowDownloadStatusResponse {
    const id = parseParam(tvdbId, 'tvdbId')
    return this.downloadsService.getShowStatus(id)
  }

  @Get('all')
  async getAllDownloads(): Promise<AllDownloadsResponse> {
    return this.downloadsService.getAllDownloads()
  }

  @Delete('movie/:tmdbId')
  async cancelMovieDownload(@Param('tmdbId') tmdbId: string): Promise<void> {
    const id = parseParam(tmdbId, 'tmdbId')
    return this.downloadsService.cancelMovieDownload(id)
  }

  @Delete('show/:tvdbId')
  async cancelShowDownloads(
    @Param('tvdbId') tvdbId: string,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const tid = parseParam(tvdbId, 'tvdbId')
    return this.downloadsService.cancelShowDownloads(tid)
  }

  @Delete('episode/:episodeId')
  async cancelEpisodeDownload(
    @Param('episodeId') episodeId: string,
  ): Promise<void> {
    const id = parseParam(episodeId, 'episodeId')
    return this.downloadsService.cancelEpisodeDownload(id)
  }

  @Delete('show/:tvdbId/season/:seasonNumber')
  async cancelSeasonDownloads(
    @Param('tvdbId') tvdbId: string,
    @Param('seasonNumber') seasonNumber: string,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const sn = z.coerce.number().int().min(0).safeParse(seasonNumber)
    if (!sn.success) {
      throw new BadRequestException(
        'seasonNumber must be a non-negative integer',
      )
    }
    return this.downloadsService.cancelSeasonDownloads(tid, sn.data)
  }
}
