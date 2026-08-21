import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { redirect } from 'next/navigation'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'

import { HomeTabs } from './HomeTabs'
import type {
  MediaRequestActionResult,
  MediaSearchActionResult,
} from './MediaRequestForm'

const SEARCH_ERROR_MESSAGE = 'Search failed. Please try again.'
const REQUEST_ERROR_MESSAGE = 'Request failed. Please try again.'

export function Home() {
  async function createDownload(data: FormData) {
    'use server'

    const url = data.get('url') as string
    const start = data.get('start') as string
    const end = data.get('end') as string

    const client = await getIdentifiedDownloadClient()
    const job = await client.createJob({
      url,

      ...(start && end
        ? {
            timeRange: {
              start,
              end,
            },
          }
        : {}),
    })

    redirect(`/downloads/${job.id}`)
  }

  async function searchMoviesAction(
    query: string,
  ): Promise<MediaSearchActionResult> {
    'use server'

    try {
      const client = await getIdentifiedDownloadClient()
      const response = await client.searchMovies(query)

      if (!Array.isArray(response?.results)) {
        return { error: SEARCH_ERROR_MESSAGE, results: [] }
      }

      // No remapping: `Media` is what the search endpoint returns and what
      // the form consumes, and `MediaRequestForm` reads the upstream id off
      // the arm itself.
      return { results: response.results }
    } catch {
      return { error: SEARCH_ERROR_MESSAGE, results: [] }
    }
  }

  async function requestMovieAction(
    tmdbId: number,
  ): Promise<MediaRequestActionResult> {
    'use server'

    try {
      const client = await getIdentifiedDownloadClient()
      const job = await client.requestMovie({ tmdbId })

      if (!job?.id || job.status === DownloadJobStatus.Failed) {
        return { error: job?.error ?? REQUEST_ERROR_MESSAGE }
      }

      return {}
    } catch {
      return { error: REQUEST_ERROR_MESSAGE }
    }
  }

  async function searchShowsAction(
    query: string,
  ): Promise<MediaSearchActionResult> {
    'use server'

    try {
      const client = await getIdentifiedDownloadClient()
      const response = await client.searchShows(query)

      if (!Array.isArray(response?.results)) {
        return { error: SEARCH_ERROR_MESSAGE, results: [] }
      }

      return { results: response.results }
    } catch {
      return { error: SEARCH_ERROR_MESSAGE, results: [] }
    }
  }

  async function requestShowAction(
    tvdbId: number,
  ): Promise<MediaRequestActionResult> {
    'use server'

    try {
      const client = await getIdentifiedDownloadClient()
      const job = await client.requestShow({ tvdbId })

      if (!job?.id || job.status === DownloadJobStatus.Failed) {
        return { error: job?.error ?? REQUEST_ERROR_MESSAGE }
      }

      return {}
    } catch {
      return { error: REQUEST_ERROR_MESSAGE }
    }
  }

  return (
    <div className="flex flex-auto items-center justify-center">
      <HomeTabs
        createDownload={createDownload}
        requestMovie={requestMovieAction}
        requestShow={requestShowAction}
        searchMovies={searchMoviesAction}
        searchShows={searchShowsAction}
      />
    </div>
  )
}
