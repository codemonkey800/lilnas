import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { TokenAuthGuard } from 'src/auth/token-auth.guard'

import { MoviesService } from './movies.service'
import { type MovieDetail } from './movies.types'

const numericIdSchema = z.coerce.number().int().positive()

function parseParam(value: string, name: string): number {
  const result = numericIdSchema.safeParse(value)
  if (!result.success) {
    throw new BadRequestException(`${name} must be a positive integer`)
  }
  return result.data
}

@Controller('movies')
@UseGuards(TokenAuthGuard)
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Get(':tmdbId')
  async getMovie(@Param('tmdbId') tmdbId: string): Promise<MovieDetail> {
    const id = parseParam(tmdbId, 'tmdbId')
    return this.moviesService.getMovie(id)
  }

  @Delete(':tmdbId/files/:fileId')
  async deleteMovieFile(
    @Param('tmdbId') tmdbId: string,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    const tid = parseParam(tmdbId, 'tmdbId')
    const fid = parseParam(fileId, 'fileId')
    return this.moviesService.deleteMovieFile(tid, fid)
  }
}
