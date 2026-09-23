import { cns } from '@lilnas/utils/cns'
import type { MediaDetailResponse } from '@lilnas/utils/download/types'
import { isMovie } from '@lilnas/utils/download/types'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { JSX } from 'react'
import { cache } from 'react'

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
import { LibraryLink } from 'src/components/detail/library-link'
import { MovieDetail } from 'src/components/detail/movie-detail'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { mediaIdFromRoute } from 'src/lib/media-route'
import { getRequestInstant } from 'src/lib/request-instant'

/** `mock.pug`'s `appBody` at both widths, spelled the way `src/app/(home)/page.tsx` does. */
const PAGE_SHELL = cns(
  'flex-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

/** The tab title when the movie's own could not be resolved. */
const FALLBACK_TITLE = 'Movie · Download'

export type MoviePageProps = {
  params: Promise<{ tmdbId: string }>
}

/**
 * ⚠️ Re-thrown, never swallowed — the same guard `src/app/actions/media-files.ts`
 * carries. Next signals a dynamic-rendering bailout, `redirect()` and
 * `notFound()` by *throwing* a value with a string `digest`; catching one of
 * those in {@link generateMetadata} would strand a navigation and break the
 * build's dynamic-rendering detection.
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
 * The detail payload, memoized for the request.
 *
 * `generateMetadata` and the page body both need it, and Next runs them in one
 * request scope, so `React.cache` collapses the two into a single
 * `GET /download/media/:id`. ⚠️ It memoizes *within* a request only — outside
 * one (a unit test calling the page function directly) it is a plain
 * passthrough, which is why nothing here asserts a call count.
 */
const loadMovieDetail = cache(
  async (mediaId: string): Promise<MediaDetailResponse> => {
    const client = await getIdentifiedDownloadClient()

    return client.getMedia(mediaId)
  },
)

async function loadBadFiles(mediaId: string) {
  const client = await getIdentifiedDownloadClient()

  return client.listBadFiles(mediaId)
}

/**
 * The tab title, from the movie itself.
 *
 * Falls back rather than throwing: a failed metadata resolution is not a reason
 * to replace the page with its error boundary, and the page's own render is
 * about to make the same call and surface the failure properly if it is real.
 */
export async function generateMetadata({
  params,
}: MoviePageProps): Promise<Metadata> {
  const { tmdbId } = await params
  const mediaId = mediaIdFromRoute('movies', tmdbId)

  if (mediaId === null) {
    return { title: FALLBACK_TITLE }
  }

  try {
    const { media } = await loadMovieDetail(mediaId)

    return { title: `${media.title} · Download` }
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    return { title: FALLBACK_TITLE }
  }
}

/**
 * `/movies/<tmdbId>` — one movie, its download state, and the release picker.
 *
 * ## What is a 404 here, and what is not
 *
 * `notFound()` answers exactly two things, and neither is "Radarr does not have
 * this movie":
 *
 * 1. **A segment that is not a plain tmdb id.** `mediaIdFromRoute` returns
 *    `null` rather than throwing for anything that is not digits-without-a-
 *    leading-zero, which is the security boundary for the mapping — without it
 *    `/movies/tmdb%3A438631` would concatenate into `tmdb:tmdb:438631`.
 * 2. **A key that resolved to something that is not a movie.** Defensive: a
 *    `tmdb:` prefix maps to `DownloadType.Movie` by construction, so this is a
 *    guard against that invariant changing, not a live path.
 *
 * ⚠️ An *unknown* tmdb id is neither. Unlike a `video:` key — which the backend
 * 404s outright, because a video cannot exist before it is downloaded — a
 * `tmdb:` key always resolves: `MediaResolverService` hands back a placeholder
 * with the source flagged degraded when Radarr cannot be reached. So a movie
 * nobody has requested is a perfectly good page (that is how a release is
 * browsed in the first place), and a Radarr outage is reported *on* the page
 * rather than disguised as a missing title. See `isMetadataUnavailable`.
 *
 * ## The back affordance
 *
 * `LibraryLink`, in the page body, which is exactly what the mockups'
 * `libraryLink` mixin is. `AppBar`'s own `back` prop is left unwired — routing
 * it would need either a nested route-group layout or a context, and the
 * mockup's arrow is an in-page control.
 *
 * Nothing is caught: `getIdentifiedDownloadClient()` reads `headers()` (making
 * this route dynamic, correctly — a download's state is per-request truth) and
 * a failing backend throws through to `error.tsx`.
 */
export default async function MoviePage({
  params,
}: MoviePageProps): Promise<JSX.Element> {
  const { tmdbId } = await params
  const mediaId = mediaIdFromRoute('movies', tmdbId)

  if (mediaId === null) {
    notFound()
  }

  const [detail, { badFiles }] = await Promise.all([
    loadMovieDetail(mediaId),
    loadBadFiles(mediaId),
  ])

  if (!isMovie(detail.media)) {
    notFound()
  }

  // One instant for every relative stamp on the page, resolved on the server
  // and handed down — see `getRequestInstant` for why that matters.
  const now = getRequestInstant()

  return (
    <main className={PAGE_SHELL}>
      <div className={cns('mx-auto max-w-[1080px]')}>
        <LibraryLink />
        <MovieDetail
          badFiles={badFiles}
          // The three unbound server actions `ImportDialog` calls, handed
          // through the detail component to the lifecycle panel. Unbound on
          // purpose: the dialog supplies the media key and the scope, so this
          // page never has to know which job is stuck.
          imports={{
            commit: importFiles,
            discard: discardImport,
            list: listImportCandidates,
          }}
          jobs={detail.jobs}
          movie={detail.media}
          now={now}
          onDelete={deleteMediaFiles}
          onFlag={flagBadFile}
          onGrab={grabRelease}
          onReplace={replaceRelease}
          onSearch={searchReleases}
          onUnflag={unflagBadFile}
        />
      </div>
    </main>
  )
}
