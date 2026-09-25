'use server'

import type { DownloadClient } from '@lilnas/utils/download/client'
import type {
  DownloadJob,
  RequestShowInput,
  ShowScope,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { mediaHref } from 'src/lib/media-route'

/**
 * The cancel and retry mutations `/movies/<tmdbId>` and `/shows/<tvdbId>`
 * offer — the movie/show counterpart of `video-job.ts`, which this module
 * mirrors action for action.
 *
 * ⚠️ This is a `'use server'` module, so it may export nothing but async
 * functions. `isFrameworkSignal`, `revalidateJobDetail` and
 * `runLifecycleAction` below are therefore module-private *copies* of the
 * ones in `video-job.ts`, not imports: that module is `'use server'` too and
 * cannot export them, and an `export const` or sync `export function` here
 * would be a build error. Keep the two copies in step.
 *
 * Every action is addressed by **job** id, never by the `tmdb:`/`tvdb:` media
 * key — `PATCH /download/{movies,shows}/:id/cancel` and
 * `GET /download/{movies,shows}/:id` all take the job. That is what lets the
 * detail page hand these to its attempt list unbound: each attempt card calls
 * the action with the id of the job it is rendering.
 */

/**
 * ⚠️ Re-thrown, never swallowed. Next signals a static-generation bailout,
 * `redirect()` and `notFound()` by *throwing* a value carrying a string
 * `digest`; catching one of those and turning it into a logged no-op would
 * silently break the build's dynamic-rendering detection.
 *
 * A copy of `video-job.ts`'s — see the module comment for why.
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
 * Refreshes the page a mutation just changed.
 *
 * Derived from the returned job's own `media` rather than from an argument,
 * because these actions are handed a job id and nothing else. `mediaHref` is
 * the single place that knows `tmdb:438631` → `/movies/438631`.
 */
function revalidateJobDetail(job: DownloadJob): void {
  revalidatePath(mediaHref(job.media))
}

/**
 * The shared body of cancel/retry.
 *
 * ⚠️ A failure is logged and swallowed, for the same reason as in
 * `video-job.ts`: `JobAction` returns `Promise<void>`, so there is no channel
 * to report on, and *throwing* would unmount the detail page into its error
 * boundary — losing the very panel that would have shown the job's unchanged
 * status.
 *
 * `getIdentifiedDownloadClient()` is resolved outside the `try` on purpose:
 * `headers()` signals a static-generation bailout by throwing a value
 * carrying a `digest`, and this keeps the `try` wrapping precisely the calls
 * that can only fail for real.
 */
async function runLifecycleAction(
  label: string,
  run: (client: DownloadClient) => Promise<DownloadJob>,
): Promise<void> {
  const client = await getIdentifiedDownloadClient()

  let job: DownloadJob

  try {
    job = await run(client)
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(`[media-job] ${label} failed`, error)

    return
  }

  revalidateJobDetail(job)
}

/**
 * The request body that asks for exactly the part of a series a show job was
 * created for.
 *
 * Only `episodeId` and `seasonNumber` cross over. `scope.episodeNumber` is a
 * display value resolved server-side at request time, and
 * `RequestShowInputSchema` does not accept it. An absent scope means the
 * whole series, so it requests the whole series.
 *
 * ⚠️ `!= null`, not truthiness: Sonarr numbers specials as season 0, and a
 * retry of a season-0 job must stay a season-0 request rather than widen to
 * the whole series.
 */
function showRequestScope(
  scope: ShowScope | undefined,
): Pick<RequestShowInput, 'episodeId' | 'seasonNumber'> {
  return {
    ...(scope?.episodeId != null && { episodeId: scope.episodeId }),
    ...(scope?.seasonNumber != null && { seasonNumber: scope.seasonNumber }),
  }
}

/**
 * Stops a movie download that is still in progress. The backend settles the
 * job once Radarr's queue item is gone.
 */
export async function cancelMovieJob(jobId: string): Promise<void> {
  await runLifecycleAction('PATCH /download/movies/:id/cancel', client =>
    client.cancelMovieJob(jobId),
  )
}

/**
 * Stops a show download that is still in progress — only the part of the
 * series the job was created for. The backend settles the job once Sonarr's
 * queue items in that scope are gone.
 */
export async function cancelShowJob(jobId: string): Promise<void> {
  await runLifecycleAction('PATCH /download/shows/:id/cancel', client =>
    client.cancelShowJob(jobId),
  )
}

/**
 * Asks for the same movie again.
 *
 * There is no retry *endpoint* — a job is an event, and re-running one would
 * rewrite history. A retry is a fresh `POST /download/movies` for the same
 * title: a new job row lands on top of the attempt list, and the attempt it
 * retries keeps its outcome beneath it.
 */
export async function retryMovieJob(jobId: string): Promise<void> {
  await runLifecycleAction('POST /download/movies (retry)', async client => {
    const previous = await client.getMovieJob(jobId)

    if (previous.media.type !== DownloadType.Movie) {
      throw new Error(`Job '${jobId}' is not a movie job`)
    }

    return client.requestMovie({ tmdbId: previous.media.tmdbId })
  })
}

/**
 * Asks for the same part of a series again — the whole series, one season,
 * or one episode, whichever the retried job was created for. Like
 * {@link retryMovieJob}, a fresh `POST /download/shows` and a new job row.
 *
 * The scope is carried across rather than defaulted: retrying a one-episode
 * attempt must not quietly widen into a whole-series download.
 */
export async function retryShowJob(jobId: string): Promise<void> {
  await runLifecycleAction('POST /download/shows (retry)', async client => {
    const previous = await client.getShowJob(jobId)

    if (previous.media.type !== DownloadType.Show) {
      throw new Error(`Job '${jobId}' is not a show job`)
    }

    return client.requestShow({
      tvdbId: previous.media.tvdbId,
      ...showRequestScope(previous.scope),
    })
  })
}
