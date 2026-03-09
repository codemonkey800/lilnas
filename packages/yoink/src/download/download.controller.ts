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

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { DownloadService } from './download.service'
import {
  type AllDownloadsResponse,
  type DownloadRequest,
  downloadRequestSchema,
  type MovieDownloadStatusResponse,
  type ShowDownloadStatusResponse,
} from './download.types'

const numericIdSchema = z.coerce.number().int().positive()

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

  /**
   * GET /downloads/movie/:tmdbId — Returns the current download status snapshot
   * for a movie, or null if no download is in progress.
   */
  @Get('movie/:tmdbId')
  async getMovieStatus(
    @Param('tmdbId') tmdbId: string,
  ): Promise<MovieDownloadStatusResponse | null> {
    const result = numericIdSchema.safeParse(tmdbId)
    if (!result.success) {
      throw new BadRequestException('tmdbId must be a positive integer')
    }
    return this.downloadService.getMovieStatus(result.data)
  }

  /**
   * DELETE /downloads/movie/:tmdbId — Cancels an active movie download,
   * removes it from the Radarr queue, and cleans up tracking state.
   */
  @Delete('movie/:tmdbId')
  async cancelMovieDownload(@Param('tmdbId') tmdbId: string): Promise<void> {
    const result = numericIdSchema.safeParse(tmdbId)
    if (!result.success) {
      throw new BadRequestException('tmdbId must be a positive integer')
    }
    return this.downloadService.cancelMovieDownload(result.data)
  }

  /**
   * DELETE /downloads/show/:tvdbId — Cancels all active episode downloads for
   * a show, removes them from the Sonarr queue, and cleans up tracking state.
   */
  @Delete('show/:tvdbId')
  async cancelShowDownloads(
    @Param('tvdbId') tvdbId: string,
    @Body() body: unknown,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const tid = numericIdSchema.safeParse(tvdbId)
    if (!tid.success) {
      throw new BadRequestException('tvdbId must be a positive integer')
    }
    const bodySchema = z.object({ seriesId: z.number().int().positive() })
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException('seriesId is required')
    }
    return this.downloadService.cancelShowDownloads(
      tid.data,
      parsed.data.seriesId,
    )
  }

  /**
   * GET /downloads/show/:tvdbId — Returns the current download status snapshots
   * for all episodes of a show currently being tracked.
   */
  @Get('show/:tvdbId')
  getShowStatus(@Param('tvdbId') tvdbId: string): ShowDownloadStatusResponse {
    const result = numericIdSchema.safeParse(tvdbId)
    if (!result.success) {
      throw new BadRequestException('tvdbId must be a positive integer')
    }
    return this.downloadService.getShowStatus(result.data)
  }

  /**
   * GET /downloads/all — Returns all currently tracked downloads with rich
   * metadata (title, year, poster) from Radarr/Sonarr. Powers the Downloads page.
   */
  @Get('all')
  async getAllDownloads(): Promise<AllDownloadsResponse> {
    return this.downloadService.getAllDownloads()
  }

  /**
   * DELETE /downloads/episode/:episodeId — Cancels a single episode download,
   * removes it from the Sonarr queue, and cleans up tracking state.
   */
  @Delete('episode/:episodeId')
  async cancelEpisodeDownload(
    @Param('episodeId') episodeId: string,
  ): Promise<void> {
    const result = numericIdSchema.safeParse(episodeId)
    if (!result.success) {
      throw new BadRequestException('episodeId must be a positive integer')
    }
    return this.downloadService.cancelEpisodeDownload(result.data)
  }

  /**
   * DELETE /downloads/show/:tvdbId/season/:seasonNumber — Cancels all episode
   * downloads in a specific season. Requires seriesId in the request body.
   */
  @Delete('show/:tvdbId/season/:seasonNumber')
  async cancelSeasonDownloads(
    @Param('tvdbId') tvdbId: string,
    @Param('seasonNumber') seasonNumber: string,
    @Body() body: unknown,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const tid = numericIdSchema.safeParse(tvdbId)
    if (!tid.success) {
      throw new BadRequestException('tvdbId must be a positive integer')
    }
    const sn = z.coerce.number().int().min(0).safeParse(seasonNumber)
    if (!sn.success) {
      throw new BadRequestException(
        'seasonNumber must be a non-negative integer',
      )
    }
    const bodySchema = z.object({ seriesId: z.number().int().positive() })
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException('seriesId is required')
    }
    return this.downloadService.cancelSeasonDownloads(
      tid.data,
      parsed.data.seriesId,
      sn.data,
    )
  }
}
