import type { DownloadClient } from '@lilnas/utils/download/client'
import type { BadFile, Season } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import type { JSX } from 'react'

import {
  deleteMediaFiles,
  discardImport,
  flagBadFile,
  grabRelease,
  importFiles,
  listImportCandidates,
  replaceRelease,
  searchReleases,
  unflagBadFile,
} from 'src/app/actions/media-files'
import { cancelShowJob, retryShowJob } from 'src/app/actions/media-job'
import { ShowDetailLive } from 'src/components/detail/show-detail-live'
import { ShowPageShell } from 'src/components/detail/show-page-shell'
import type {
  ShowRequestResult,
  ShowRequestScope,
} from 'src/components/detail/show-request-button'
import { JobEventsProvider } from 'src/components/live/job-events'
import { mediaIdSuffix } from 'src/db/media-id'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { mediaIdFromRoute } from 'src/lib/media-route'
import { getRequestInstant } from 'src/lib/request-instant'

export type ShowPageProps = {
  params: Promise<{ tvdbId: string }>
}

const REQUEST_FAILED = 'Could not start that download — try again'

/**
 * ⚠️ Re-thrown, never swallowed. Next signals a static-generation bailout,
 * `redirect()` and `notFound()` by *throwing* a value carrying a string
 * `digest`; catching one and answering with a fallback would silently break
 * the build's dynamic-rendering detection and strand a navigation. The same
 * guard `media-files.ts` and `viewer.ts` both carry.
 */
function isFrameworkSignal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string'
  )
}

/**
 * Starts a scoped show download.
 *
 * ⚠️ **This writes to the real Sonarr library** - `POST /download/shows` adds
 * or updates the series, sets monitoring for the scope and fires a search.
 *
 * ⚠️ The scope travels as `{ episodeId }` / `{ seasonNumber }` / `{}` and the
 * media key is **never** touched: `tvdbId` is parsed back out of the same
 * `tvdb:121361` key every other call on this page uses, which is what keeps a
 * show one card in the gallery however many episodes were fetched one at a
 * time. `ShowRequestButton` builds the scope from a discriminated union
 * (`showRequestScope`), so no call site assembles one by hand.
 *
 * An inline server action rather than a module in `src/app/actions/`: this is
 * the only page that requests a show, and the action closes over nothing, so a
 * shared module would buy nothing but another file. Failures come back as a
 * result rather than a throw, so one refused episode does not replace the whole
 * series with an error card.
 */
async function requestShowScope(
  mediaId: string,
  scope: ShowRequestScope,
): Promise<ShowRequestResult> {
  'use server'

  const tvdbId = Number(mediaIdSuffix(mediaId))

  if (!Number.isSafeInteger(tvdbId) || tvdbId <= 0) {
    return { error: REQUEST_FAILED }
  }

  // Outside the `try`, exactly as in `media-files.ts`: `headers()` signals a
  // static-generation bailout by throwing a value carrying a `digest`, and this
  // keeps the `try` wrapping precisely one call.
  const client = await getIdentifiedDownloadClient()

  try {
    const job = await client.requestShow({ ...scope, tvdbId })

    revalidatePath(`/shows/${tvdbId}`)

    return { job }
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error('[shows] POST /download/shows failed', error)

    return { error: REQUEST_FAILED }
  }
}

/**
 * The seasons, or an empty list.
 *
 * ⚠️ `GET /media/:id/seasons` answers **404 for a series that is not in Sonarr
 * yet** ("is not in the library, so it has no seasons yet"), which is a
 * completely ordinary state for a show reached from `/discover` or `/search`.
 * Letting that reach the error boundary would tell a user something is broken
 * when the honest answer is "nothing has been downloaded, here is the button".
 * Any *other* failure is re-thrown and lands on `error.tsx`.
 */
async function loadSeasons(
  client: DownloadClient,
  mediaId: string,
): Promise<Season[]> {
  try {
    const { seasons } = await client.listSeasons(mediaId)

    return seasons
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.warn('[shows] GET /media/:id/seasons failed', error)

    return []
  }
}

/**
 * The bad-file flags, or none.
 *
 * Degraded rather than fatal on purpose: the flags only annotate rows inside a
 * release list nobody has asked for yet, so losing them costs a chip. Losing
 * the page over it would not be a trade worth making.
 */
async function loadBadFiles(
  client: DownloadClient,
  mediaId: string,
): Promise<BadFile[]> {
  try {
    const { badFiles } = await client.listBadFiles(mediaId)

    return badFiles
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.warn('[shows] GET /media/:id/bad-files failed', error)

    return []
  }
}

/**
 * Static rather than a `generateMetadata` that names the show: the title is
 * only knowable by asking Sonarr, and `getMedia` has no request-level cache
 * behind it, so a titled tab would cost a second upstream round trip on every
 * navigation.
 */
export const metadata = {
  title: 'Show · Download',
}

/**
 * `/shows/<tvdbId>` - a series, its seasons, its episodes, and the three
 * scopes each of download and delete.
 *
 * ## What is fetched, and what is deliberately not
 *
 * `getMedia` and `listSeasons` in parallel, plus `listBadFiles`.
 * **`listReleases` is not called**, at any scope, ever, from this page: it is a
 * 30s+ indexer sweep that *writes upstream* (Radarr and Sonarr will not surface
 * releases for an unmonitored title, so the backend borrows monitoring to ask).
 * `searchReleases` is handed down as a prop and reaches exactly one caller -
 * `ReleasePicker`'s own trigger press. Nothing on this page calls it on mount,
 * on hover, or on a prefetch.
 *
 * ## 404 vs. an honest failure
 *
 * ⚠️ A `tvdb:` key **always resolves**: `MediaResolverService` catches an
 * upstream failure and emits a placeholder rather than propagating it, so an
 * unknown or unreachable show comes back `200` with its own key as its title.
 * So `notFound()` is reserved for the one case that genuinely is not a page -
 * a route segment that is not a plain positive integer, which `mediaIdFromRoute`
 * rejects with `null`. A failed *metadata lookup* is reported as what it is,
 * in a note above the header (see `isMetadataMissing`), with the seasons and
 * episodes still rendered underneath.
 */
export default async function ShowPage({
  params,
}: ShowPageProps): Promise<JSX.Element> {
  const { tvdbId } = await params
  const mediaId = mediaIdFromRoute('shows', tvdbId)

  // The only genuine 404 on this route. `mediaIdFromRoute` answers `null`
  // rather than throwing for a segment that is not a bare positive integer,
  // which is also the security boundary on the prefix it reattaches.
  if (!mediaId) {
    notFound()
  }

  const client = await getIdentifiedDownloadClient()

  const [detail, seasons, badFiles] = await Promise.all([
    client.getMedia(mediaId),
    loadSeasons(client, mediaId),
    loadBadFiles(client, mediaId),
  ])

  // A `tvdb:` key resolves to a `Show` or to a `Show`-shaped placeholder, so
  // this is unreachable in practice - but `Media` is a union and the narrowing
  // has to be real for `ShowDetail` to take it.
  if (detail.media.type !== DownloadType.Show) {
    notFound()
  }

  return (
    <ShowPageShell>
      {/* Placed as on the movie page: the socket belongs to this page alone. */}
      <JobEventsProvider>
        <ShowDetailLive
          badFiles={badFiles}
          // The three unbound server actions `ImportDialog` calls. They reach
          // both the series panel and each season panel; the scope that narrows
          // every request is read off the stuck job, never assembled here.
          imports={{
            commit: importFiles,
            discard: discardImport,
            list: listImportCandidates,
          }}
          jobs={detail.jobs}
          media={detail.media}
          now={getRequestInstant()}
          seasons={seasons}
          onCancel={cancelShowJob}
          onDelete={deleteMediaFiles}
          onFlag={flagBadFile}
          onGrab={grabRelease}
          onReplace={replaceRelease}
          onRequest={requestShowScope}
          onRetry={retryShowJob}
          onSearch={searchReleases}
          onUnflag={unflagBadFile}
        />
      </JobEventsProvider>
    </ShowPageShell>
  )
}
