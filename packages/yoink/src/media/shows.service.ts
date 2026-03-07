import { Injectable, NotFoundException } from '@nestjs/common'

import { type ShowDetail } from './shows'
import { getShow } from './shows.server'

@Injectable()
export class ShowsService {
  /**
   * Fetches show details by TVDB ID. Wraps the server-side data layer
   * and converts unknown errors into {@link NotFoundException}.
   */
  async getShow(tvdbId: number): Promise<ShowDetail> {
    try {
      return await getShow(tvdbId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Show not found: ${message}`)
    }
  }
}
