import { type NextRequest, NextResponse } from 'next/server'

import { getSearchState } from 'src/media/show-search-store'

export const dynamic = 'force-dynamic'

export interface SearchStateResponse {
  searchingEpisodeIds: number[]
  timedOutEpisodeIds: number[]
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<SearchStateResponse | null>> {
  const seriesId = Number(request.nextUrl.searchParams.get('seriesId'))
  if (!seriesId || Number.isNaN(seriesId)) {
    return NextResponse.json(null, { status: 400 })
  }

  return NextResponse.json(getSearchState(seriesId))
}
