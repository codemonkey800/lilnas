import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { type ShowDetail, type ShowRelease } from './shows'
import { ShowsService } from './shows.service'

const numericIdSchema = z.coerce.number().int().positive()

const seriesIdBodySchema = z.object({ seriesId: z.number().int().positive() })
const grabReleaseBodySchema = z.object({
  guid: z.string().min(1),
  indexerId: z.number().int().positive(),
})
const monitoredBodySchema = z.object({ monitored: z.boolean() })
const addShowBodySchema = z.object({ tvdbId: z.number().int().positive() })
const removeShowQuerySchema = z.object({
  tvdbId: z.coerce.number().int().positive(),
})
const clearNotFoundBodySchema = z.object({
  seasonNumber: z.number().int().min(0),
  episodeNumber: z.number().int().min(0),
})

function parseParam(value: string, name: string): number {
  const result = numericIdSchema.safeParse(value)
  if (!result.success) {
    throw new BadRequestException(`${name} must be a positive integer`)
  }
  return result.data
}

function parseBody<T>(
  body: unknown,
  schema: z.ZodSchema<T>,
  message?: string,
): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException(
      message ?? result.error.issues[0]?.message ?? 'Invalid request body',
    )
  }
  return result.data
}

@Controller('shows')
@UseGuards(JwtAuthGuard)
export class ShowsController {
  constructor(private readonly showsService: ShowsService) {}

  @Get('episodes/:episodeId/releases')
  async searchEpisodeReleases(
    @Param('episodeId') episodeId: string,
  ): Promise<ShowRelease[]> {
    const id = parseParam(episodeId, 'episodeId')
    return this.showsService.searchEpisodeReleases(id)
  }

  @Put('episodes/:episodeId/monitored')
  async setEpisodeMonitored(
    @Param('episodeId') episodeId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = parseParam(episodeId, 'episodeId')
    const { monitored } = parseBody(body, monitoredBodySchema)
    return this.showsService.setEpisodeMonitored(id, monitored)
  }

  @Post('library')
  async addShowToLibrary(@Body() body: unknown): Promise<{ seriesId: number }> {
    const { tvdbId } = parseBody(body, addShowBodySchema)
    return this.showsService.addShowToLibrary(tvdbId)
  }

  @Delete('library/:seriesId')
  async removeShowFromLibrary(
    @Param('seriesId') seriesId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<void> {
    const sid = parseParam(seriesId, 'seriesId')
    const { tvdbId } = parseBody(query, removeShowQuerySchema)
    return this.showsService.removeShowFromLibrary(sid, tvdbId)
  }

  @Get(':tvdbId')
  async getShow(@Param('tvdbId') tvdbId: string): Promise<ShowDetail> {
    const id = parseParam(tvdbId, 'tvdbId')
    return this.showsService.getShow(id)
  }

  @Delete(':tvdbId/queue/:queueId')
  async cancelQueueItem(
    @Param('tvdbId') tvdbId: string,
    @Param('queueId') queueId: string,
  ): Promise<void> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const qid = parseParam(queueId, 'queueId')
    return this.showsService.cancelQueueItem(tid, qid)
  }

  @Delete(':tvdbId/queue')
  async cancelAllQueueItems(
    @Param('tvdbId') tvdbId: string,
    @Body() body: unknown,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const { seriesId } = parseBody(body, seriesIdBodySchema)
    return this.showsService.cancelAllQueueItems(tid, seriesId)
  }

  @Delete(':tvdbId/episodes/files/:episodeFileId')
  async deleteEpisodeFile(
    @Param('tvdbId') tvdbId: string,
    @Param('episodeFileId') episodeFileId: string,
  ): Promise<void> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const fid = parseParam(episodeFileId, 'episodeFileId')
    return this.showsService.deleteEpisodeFile(tid, fid)
  }

  @Delete(':tvdbId/seasons/:seasonNumber/files')
  async deleteSeasonFiles(
    @Param('tvdbId') tvdbId: string,
    @Param('seasonNumber') seasonNumber: string,
    @Body() body: unknown,
  ): Promise<void> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const sn = parseParam(seasonNumber, 'seasonNumber')
    const { seriesId } = parseBody(body, seriesIdBodySchema)
    return this.showsService.deleteSeasonFiles(tid, sn, seriesId)
  }

  @Post(':tvdbId/releases/grab')
  async grabRelease(
    @Param('tvdbId') tvdbId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const { guid, indexerId } = parseBody(body, grabReleaseBodySchema)
    return this.showsService.grabRelease(tid, guid, indexerId)
  }

  @Delete(':tvdbId/episodes/search-not-found')
  async clearEpisodeSearchNotFound(
    @Param('tvdbId') tvdbId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const { seasonNumber, episodeNumber } = parseBody(
      body,
      clearNotFoundBodySchema,
    )
    return this.showsService.clearEpisodeSearchNotFound(
      tid,
      seasonNumber,
      episodeNumber,
    )
  }
}
