import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { type LibraryItem, type SearchFilter } from './library'
import { LibraryService } from './library.service'

const searchQuerySchema = z.object({
  term: z.string().min(1),
  filter: z.enum(['all', 'movies', 'shows']).default('all'),
})

@Controller('library')
@UseGuards(JwtAuthGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get()
  async getLibrary(): Promise<LibraryItem[]> {
    return this.libraryService.getLibrary()
  }

  @Get('search')
  async search(
    @Query() query: Record<string, unknown>,
  ): Promise<LibraryItem[]> {
    const result = searchQuerySchema.safeParse(query)
    if (!result.success) {
      throw new BadRequestException(
        'Query must include term (non-empty string) and optional filter (all|movies|shows)',
      )
    }
    return this.libraryService.search(
      result.data.term,
      result.data.filter as SearchFilter,
    )
  }
}
