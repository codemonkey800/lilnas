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

import { ShowsService } from './shows.service'
import { type ShowDetail } from './shows.types'

const numericIdSchema = z.coerce.number().int().positive()

function parseParam(value: string, name: string): number {
  const result = numericIdSchema.safeParse(value)
  if (!result.success) {
    throw new BadRequestException(`${name} must be a positive integer`)
  }
  return result.data
}

@Controller('shows')
@UseGuards(TokenAuthGuard)
export class ShowsController {
  constructor(private readonly showsService: ShowsService) {}

  @Get(':tvdbId')
  async getShow(@Param('tvdbId') tvdbId: string): Promise<ShowDetail> {
    const id = parseParam(tvdbId, 'tvdbId')
    return this.showsService.getShow(id)
  }

  @Delete(':tvdbId/files/:episodeFileId')
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
  ): Promise<{ deletedFileIds: number[] }> {
    const tid = parseParam(tvdbId, 'tvdbId')
    const sn = z.coerce.number().int().min(0).safeParse(seasonNumber)
    if (!sn.success) {
      throw new BadRequestException(
        'seasonNumber must be a non-negative integer',
      )
    }
    return this.showsService.deleteSeasonFiles(tid, sn.data)
  }
}
