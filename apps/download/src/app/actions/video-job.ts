'use server'

import type { DownloadClient } from '@lilnas/utils/download/client'
import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { mediaHref } from 'src/lib/media-route'

/**
 * The four lifecycle mutations `/videos/<videoId>` offers, plus the delete
 * that outlives them.
 *
 * ⚠️ This is a `'use server'` module, so it may export nothing but async
 * functions. The error copy and the two helpers below are module-private for
 * exactly that reason, not as a style choice — an `export const` here is a
 * build error. `export type` erases at compile time and is fine. See
 * `media-files.ts` and `start-video-download.ts`, which both carry this note.
 *
 * Every one of these is addressed by **job** id, never by the `video:` media
 * key — `PATCH /download/videos/:id/{cancel,pause,resume}` and
 * `DELETE /download/videos/:id` all take the job. That is also why the four
 * lifecycle actions can be passed to `AttemptList` completely unbound: its
 * `JobAction` is `(jobId: string) => …` and each attempt card calls it with
 * the id of the job it is rendering, so the page never picks a job itself.
 */

/**
 * What {@link deleteVideoJob} answers with.
 *
 * A discriminated result rather than a throw, matching `ReleaseActionResult`
 * in `media-files.ts`: a delete is offered from the detail page itself, and a
 * thrown server action would hit the route's error boundary and replace the
 * whole page with "video unavailable" when the only thing that failed was one
 * button.
 *
 * ⚠️ The four lifecycle actions deliberately **cannot** do this. E1's
 * `JobAction` is typed `(jobId: string) => Promise<void> | void`, and
 * `Promise<{ error: string }>` is not assignable to `Promise<void>`, so a
 * result shape there would not fit the prop it exists to fill. They log and
 * return instead — see {@link runLifecycleAction}.
 */
export type DeleteVideoJobResult = { error: string } | { job: DownloadJob }

const DELETE_FAILED = 'Could not delete that video — try again'

/**
 * ⚠️ Re-thrown, never swallowed. Next signals a static-generation bailout,
 * `redirect()` and `notFound()` by *throwing* a value carrying a string
 * `digest`; catching one of those and turning it into a logged no-op would
 * silently break the build's dynamic-rendering detection.
 *
 * Spelled here rather than imported from `media-files.ts`, which is a
 * `'use server'` module and therefore cannot export it.
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
 * the single place that knows `video:<nanoid>` → `/videos/<nanoid>`; the same
 * composition `media-files.ts` reaches through `detailPath()` from the other
 * end.
 */
function revalidateJobDetail(job: DownloadJob): void {
  revalidatePath(mediaHref(job.media))
}

/**
 * The shared body of cancel/pause/resume/retry.
 *
 * ⚠️ A failure is logged and swallowed, which is the one thing about this
 * module worth arguing with. It is forced by the contract: `JobAction` returns
 * `Promise<void>`, so there is no channel to report on, and *throwing* would
 * unmount the detail page into its error boundary — losing the very panel that
 * would have shown the job's unchanged status. The observable result of a
 * failed pause is therefore "the chip still says downloading", which is true.
 *
 * `getIdentifiedDownloadClient()` is resolved outside the `try` on purpose,
 * exactly as in `start-video-download.ts`: `headers()` signals a
 * static-generation bailout by throwing a value carrying a `digest`, and this
 * keeps the `try` wrapping precisely the calls that can only fail for real.
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

    console.error(`[video-job] ${label} failed`, error)

    return
  }

  revalidateJobDetail(job)
}

/**
 * Stops a running or queued video download (spec §8).
 *
 * The backend answers a cancel on a `Completed` job with a 404 — a finished
 * download has nothing left to stop — which is why `jobActionState` offers
 * this only while the job is still in progress and why
 * {@link deleteVideoJob} exists as the separate "remove it now that it is
 * finished" verb.
 */
export async function cancelVideoJob(jobId: string): Promise<void> {
  await runLifecycleAction('PATCH /download/videos/:id/cancel', client =>
    client.cancelJob(jobId),
  )
}

/**
 * Holds a running download in place, keeping what has already landed.
 *
 * ⚠️ `Downloading` is the only status this is legal in; the API answers 409
 * everywhere else. `jobActionState` already refuses to render the button
 * outside that status, so reaching this with a 409 means the job moved between
 * the render and the press — which is exactly the case the swallow above is
 * for.
 */
export async function pauseVideoJob(jobId: string): Promise<void> {
  await runLifecycleAction('PATCH /download/videos/:id/pause', client =>
    client.pauseJob(jobId),
  )
}

/** Puts a paused download back on the queue. */
export async function resumeVideoJob(jobId: string): Promise<void> {
  await runLifecycleAction('PATCH /download/videos/:id/resume', client =>
    client.resumeJob(jobId),
  )
}

/**
 * Asks for the same video again — the video page's **Download**, offered
 * while the video has no file: after a failed or cancelled attempt, or after
 * {@link deleteVideoJob} removed what a completed one fetched.
 *
 * There is no retry *endpoint* — a job is an event, and re-running one would
 * rewrite history. A retry is therefore a new `POST /download/videos` for the
 * same source, which is not a second page either: `videos.naturalKey` is
 * `{sourceUrl}#{start}-{end}` behind a unique index, so
 * `upsertVideoByNaturalKey()` collapses the request onto the existing row and
 * keeps its first-minted `id`. The user lands back on this same URL with the
 * new attempt on top and the failed one beneath it in `AttemptList`.
 *
 * That is also why `timeRange` and `hiddenAttribution` are carried across
 * rather than defaulted: dropping the range would mint a *different* natural
 * key and strand the retry on a second page, and dropping the flag would
 * un-hide an attribution the requester deliberately hid.
 *
 * ⚠️ **Not offered for a link yt-dlp does not recognise.** That job will fail
 * identically every time, so `VideoDetail` withholds the handler and the
 * button never renders — see `isUnrecognizedLink`.
 */
export async function retryVideoJob(jobId: string): Promise<void> {
  await runLifecycleAction('POST /download/videos (retry)', async client => {
    const previous = await client.getJob(jobId)

    if (previous.media.type !== DownloadType.Video) {
      throw new Error(`Job '${jobId}' is not a video job`)
    }

    return client.createJob({
      hiddenAttribution: previous.hiddenAttribution,
      timeRange: previous.media.timeRange,
      url: previous.media.sourceUrl,
    })
  })
}

/**
 * Removes a downloaded video for good — stops it if it is still running,
 * deletes its MinIO objects, and clears the URLs that pointed at them.
 *
 * ⚠️ Destructive and irreversible. It is the one thing `cancelVideoJob` cannot
 * do (cancel 404s once a job is `Completed`), and the video counterpart of
 * `DELETE /download/movies/:id` — **not** of `deleteMediaFiles`, which refuses
 * a `video:` key outright.
 *
 * The `videos` row deliberately survives: it is keyed on
 * `(sourceUrl, timeRange)` and every job's `mediaId` points at it, so deleting
 * it would orphan history rather than clean it up. So does the job: a
 * finished attempt keeps its outcome (a completed one did fetch the file) and
 * only one still running lands on `Cancelled`. This page stays reachable,
 * honestly showing a video with no file and a Download to fetch it again —
 * which is why nothing here navigates away and revalidating the detail path
 * is the whole of the refresh.
 */
export async function deleteVideoJob(
  jobId: string,
): Promise<DeleteVideoJobResult> {
  const client = await getIdentifiedDownloadClient()

  let job: DownloadJob

  try {
    job = await client.deleteJob(jobId)
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error('[video-job] DELETE /download/videos/:id failed', error)

    return { error: DELETE_FAILED }
  }

  revalidateJobDetail(job)

  return { job }
}
