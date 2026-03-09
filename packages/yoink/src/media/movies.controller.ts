import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { type MovieDetail, type MovieRelease } from './movies'
import { MoviesService } from './movies.service'

const numericIdSchema = z.coerce.number().int().positive()

const grabReleaseSchema = z.object({
  guid: z.string().min(1),
  indexerId: z.number().int().positive(),
})

const monitoredSchema = z.object({
  monitored: z.boolean(),
})

const addToLibrarySchema = z.object({
  tmdbId: z.number().int().positive(),
})

function parseParam(value: string, name: string): number {
  const result = numericIdSchema.safeParse(value)
  if (!result.success) {
    throw new BadRequestException(`${name} must be a positive integer`)
  }
  return result.data
}

function parseBody<T>(body: unknown, schema: z.ZodSchema<T>, message?: string): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException(
      message ?? result.error.issues[0]?.message ?? 'Invalid request body',
    )
  }
  return result.data
}

@Controller('movies')
@UseGuards(JwtAuthGuard)
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Post('library')
  async addToLibrary(@Body() body: unknown): Promise<{ movieId: number }> {
    const { tmdbId } = parseBody(
      body,
      addToLibrarySchema,
      'Body must include tmdbId as positive integer',
    )
    return this.moviesService.addToLibrary(tmdbId)
  }

  @Delete('library/:movieId')
  async removeFromLibrary(@Param('movieId') movieId: string): Promise<void> {
    const id = parseParam(movieId, 'movieId')
    return this.moviesService.removeFromLibrary(id)
  }

  @Get(':movieId/releases')
  async searchReleases(
    @Param('movieId') movieId: string,
  ): Promise<MovieRelease[]> {
    const id = parseParam(movieId, 'movieId')
    return this.moviesService.searchReleases(id)
  }

  @Put(':movieId/monitored')
  async setMonitored(
    @Param('movieId') movieId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = parseParam(movieId, 'movieId')
    const { monitored } = parseBody(
      body,
      monitoredSchema,
      'Body must include monitored as boolean',
    )
    return this.moviesService.setMonitored(id, monitored)
  }

  @Delete(':tmdbId/queue/:queueId')
  async cancelDownload(
    @Param('tmdbId') tmdbId: string,
    @Param('queueId') queueId: string,
  ): Promise<void> {
    parseParam(tmdbId, 'tmdbId')
    const qid = parseParam(queueId, 'queueId')
    return this.moviesService.cancelDownload(qid)
  }

  @Delete(':tmdbId/files/:fileId')
  async deleteMovieFile(
    @Param('tmdbId') tmdbId: string,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    parseParam(tmdbId, 'tmdbId')
    const fid = parseParam(fileId, 'fileId')
    return this.moviesService.deleteMovieFile(fid)
  }

  @Post(':tmdbId/releases/grab')
  async grabRelease(
    @Param('tmdbId') tmdbId: string,
    @Body() body: unknown,
  ): Promise<void> {
    parseParam(tmdbId, 'tmdbId')
    const { guid, indexerId } = parseBody(
      body,
      grabReleaseSchema,
      'Body must include guid (string) and indexerId (positive integer)',
    )
    return this.moviesService.grabRelease(guid, indexerId)
  }

  @Post(':tmdbId/search-not-found')
  async recordSearchNotFound(@Param('tmdbId') tmdbId: string): Promise<void> {
    const id = parseParam(tmdbId, 'tmdbId')
    return this.moviesService.recordSearchNotFound(id)
  }

  @Delete(':tmdbId/search-not-found')
  async clearSearchNotFound(@Param('tmdbId') tmdbId: string): Promise<void> {
    const id = parseParam(tmdbId, 'tmdbId')
    return this.moviesService.clearSearchNotFound(id)
  }

  @Get(':tmdbId')
  async getMovie(@Param('tmdbId') tmdbId: string): Promise<MovieDetail> {
    const id = parseParam(tmdbId, 'tmdbId')
    return this.moviesService.getMovie(id)
  }
}
