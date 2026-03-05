'use client'

import { useQuery } from '@tanstack/react-query'

import type { SearchStateResponse } from 'src/app/api/shows/search-state/route'

const ACTIVE_POLL_INTERVAL_MS = 2000
const TIMED_OUT_POLL_INTERVAL_MS = 5000

async function fetchSearchState(seriesId: number): Promise<SearchStateResponse> {
  const res = await fetch(`/api/shows/search-state?seriesId=${seriesId}`)
  return res.json()
}

export function useSearchState(
  seriesId: number,
  initialState: SearchStateResponse,
) {
  const { data } = useQuery({
    queryKey: ['show-search-state', seriesId],
    queryFn: () => fetchSearchState(seriesId),
    initialData: initialState,
    refetchInterval: query => {
      const s = query.state.data
      if ((s?.searchingEpisodeIds.length ?? 0) > 0) return ACTIVE_POLL_INTERVAL_MS
      if ((s?.timedOutEpisodeIds.length ?? 0) > 0) return TIMED_OUT_POLL_INTERVAL_MS
      return false
    },
  })

  return {
    searchingEpisodeIds: new Set(data?.searchingEpisodeIds),
    timedOutEpisodeIds: new Set(data?.timedOutEpisodeIds),
    hasActiveSearches: (data?.searchingEpisodeIds.length ?? 0) > 0,
  }
}
