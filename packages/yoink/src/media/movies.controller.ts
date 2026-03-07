import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { type MovieDetail } from './movies'
import { MoviesService } from './movies.service'

const numericIdSchema = z.coerce.number().int().positive()

@Controller('movies')
@UseGuards(JwtAuthGuard)
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  /** GET /movies/:tmdbId — Returns full movie details including files and queue state. */
  @Get(':tmdbId')
  async getMovie(@Param('tmdbId') tmdbId: string): Promise<MovieDetail> {
    const result = numericIdSchema.safeParse(tmdbId)
    if (!result.success) {
      throw new BadRequestException('tmdbId must be a positive integer')
    }
    return this.moviesService.getMovie(result.data)
  }
}
