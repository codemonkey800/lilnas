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

@Controller('movies')
@UseGuards(JwtAuthGuard)
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Post('library')
  async addToLibrary(@Body() body: unknown): Promise<{ movieId: number }> {
    const result = addToLibrarySchema.safeParse(body)
    if (!result.success) {
      throw new BadRequestException(
        'Body must include tmdbId as positive integer',
      )
    }
    return this.moviesService.addToLibrary(result.data.tmdbId)
  }

  @Delete('library/:movieId')
  async removeFromLibrary(@Param('movieId') movieId: string): Promise<void> {
    const result = numericIdSchema.safeParse(movieId)
    if (!result.success) {
      throw new BadRequestException('movieId must be a positive integer')
    }
    return this.moviesService.removeFromLibrary(result.data)
  }

  @Get(':movieId/releases')
  async searchReleases(
    @Param('movieId') movieId: string,
  ): Promise<MovieRelease[]> {
    const result = numericIdSchema.safeParse(movieId)
    if (!result.success) {
      throw new BadRequestException('movieId must be a positive integer')
    }
    return this.moviesService.searchReleases(result.data)
  }

  @Put(':movieId/monitored')
  async setMonitored(
    @Param('movieId') movieId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const idResult = numericIdSchema.safeParse(movieId)
    if (!idResult.success) {
      throw new BadRequestException('movieId must be a positive integer')
    }
    const bodyResult = monitoredSchema.safeParse(body)
    if (!bodyResult.success) {
      throw new BadRequestException('Body must include monitored as boolean')
    }
    return this.moviesService.setMonitored(
      idResult.data,
      bodyResult.data.monitored,
    )
  }

  @Delete(':tmdbId/queue/:queueId')
  async cancelDownload(@Param('queueId') queueId: string): Promise<void> {
    const result = numericIdSchema.safeParse(queueId)
    if (!result.success) {
      throw new BadRequestException('queueId must be a positive integer')
    }
    return this.moviesService.cancelDownload(result.data)
  }

  @Delete(':tmdbId/files/:fileId')
  async deleteMovieFile(@Param('fileId') fileId: string): Promise<void> {
    const result = numericIdSchema.safeParse(fileId)
    if (!result.success) {
      throw new BadRequestException('fileId must be a positive integer')
    }
    return this.moviesService.deleteMovieFile(result.data)
  }

  @Post(':tmdbId/releases/grab')
  async grabRelease(@Body() body: unknown): Promise<void> {
    const result = grabReleaseSchema.safeParse(body)
    if (!result.success) {
      throw new BadRequestException(
        'Body must include guid (string) and indexerId (positive integer)',
      )
    }
    return this.moviesService.grabRelease(
      result.data.guid,
      result.data.indexerId,
    )
  }

  @Post(':tmdbId/search-not-found')
  async recordSearchNotFound(@Param('tmdbId') tmdbId: string): Promise<void> {
    const result = numericIdSchema.safeParse(tmdbId)
    if (!result.success) {
      throw new BadRequestException('tmdbId must be a positive integer')
    }
    return this.moviesService.recordSearchNotFound(result.data)
  }

  @Delete(':tmdbId/search-not-found')
  async clearSearchNotFound(@Param('tmdbId') tmdbId: string): Promise<void> {
    const result = numericIdSchema.safeParse(tmdbId)
    if (!result.success) {
      throw new BadRequestException('tmdbId must be a positive integer')
    }
    return this.moviesService.clearSearchNotFound(result.data)
  }

  @Get(':tmdbId')
  async getMovie(@Param('tmdbId') tmdbId: string): Promise<MovieDetail> {
    const result = numericIdSchema.safeParse(tmdbId)
    if (!result.success) {
      throw new BadRequestException('tmdbId must be a positive integer')
    }
    return this.moviesService.getMovie(result.data)
  }
}
