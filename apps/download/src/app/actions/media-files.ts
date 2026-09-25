'use server'

import { DownloadApiError } from '@lilnas/utils/download/client'
import type {
  BadFile,
  DeleteMediaFilesQuery,
  DiscardImportQuery,
  DownloadJob,
  FlagBadFileInput,
  GrabReleaseInput,
  ImportFilesInput,
  ListImportCandidatesQuery,
  ListReleasesQuery,
  ManualImportCandidate,
  Release,
  ReplaceReleaseInput,
} from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'

import { mediaIdSuffix, mediaTypeFromKey } from 'src/db/media-id'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { routeKindFromType } from 'src/lib/media-route'

/**
 * ⚠️ This is a `'use server'` module, so it may export nothing but async
 * functions. Every `export type` below erases at compile time and is therefore
 * fine; the error copy and the path helper are module-private for exactly that
 * reason, not as a style choice. See `start-video-download.ts`, which carries
 * the same note.
 */

/**
 * What {@link grabRelease} and {@link replaceRelease} answer with.
 *
 * A discriminated result rather than a thrown error, because both are called
 * from a client component that has to render the failure *next to the release
 * row that failed* — a thrown server action would hit the route's error
 * boundary and take the whole detail page down with it, losing the list the
 * user just waited 30 seconds for.
 */
export type ReleaseActionResult = { error: string } | { job: DownloadJob }

/** What {@link flagBadFile} and {@link unflagBadFile} answer with. */
export type BadFileActionResult = { badFile: BadFile } | { error: string }

/** What {@link deleteMediaFiles} answers with. */
export type DeleteMediaFilesResult =
  | { deletedCount: number }
  | { error: string }

/** What {@link searchReleases} answers with. */
export type ReleaseSearchResult = { error: string } | { releases: Release[] }

/** What {@link listImportCandidates} answers with. */
export type ImportCandidatesResult =
  | { candidates: ManualImportCandidate[] }
  | { error: string }

/** What {@link importFiles} answers with. */
export type ImportFilesResult = { error: string } | { importedCount: number }

/** What {@link discardImport} answers with. */
export type DiscardImportResult = { discardedCount: number } | { error: string }

/**
 * The refusal the backend answers a grab of a flagged release with (409).
 *
 * It is written as copy rather than left to the generic failure message
 * because the UI is supposed to make this unreachable: `ReleasePicker`
 * disables a `flaggedBad` row *and says why*. Anyone who still gets here
 * raced a flag landing from another tab, so the message names the same cause
 * the disabled row names.
 */
const GRAB_FLAGGED = 'That release is reported as a bad file — pick another one'
const GRAB_FAILED = 'Could not start that download — try again'
const SEARCH_FAILED = 'No indexer answered — try again in a minute'
const REPLACE_FAILED = 'Could not replace that file — try again'
const FLAG_FAILED = 'Could not send that report — try again'
const UNFLAG_FAILED = 'Could not undo that report — try again'
const DELETE_FAILED = 'Could not delete those files — try again'
const IMPORT_LIST_FAILED =
  'Could not read what is waiting to import — try again'
const IMPORT_FAILED = 'Could not start the import — try again'

/**
 * The 404 branch on import and discard: upstream no longer has the queue row.
 *
 * Not a failure of ours, and not "try again" — somebody else already imported
 * or discarded it, or Radarr/Sonarr retried the import on its own and moved on.
 * The only wrong thing left is the page the user is looking at, which is why
 * this branch still revalidates.
 */
const IMPORT_NOTHING = 'Nothing is waiting to be imported any more'
const DISCARD_FAILED = 'Could not discard that download — try again'

/**
 * ⚠️ Re-thrown, never swallowed. Next signals a static-generation bailout,
 * `redirect()` and `notFound()` by *throwing* a value carrying a string
 * `digest`; catching one of those and turning it into `{ error }` would
 * silently break the build's dynamic-rendering detection and strand a
 * navigation.
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
 * The detail route a `mediaId()` key belongs to — `tmdb:438631` →
 * `/movies/438631`.
 *
 * Composed out of the two existing inverses (`mediaTypeFromKey`, the exact
 * inverse of `mediaId()`'s prefix choice, and `routeKindFromType`, the
 * `DownloadType` → segment map) rather than re-spelling the prefixes here.
 * `mediaHref()` is the same composition starting from a whole `Media`; this
 * one starts from the key, which is all a mutation is ever handed.
 *
 * `null` for an unrecognized prefix, which just means nothing is revalidated
 * — the mutation itself still happened, and the backend has already rejected
 * a genuinely malformed key by then.
 */
function detailPath(mediaId: string): string | null {
  const type = mediaTypeFromKey(mediaId)

  if (!type) {
    return null
  }

  return `/${routeKindFromType(type)}/${encodeURIComponent(mediaIdSuffix(mediaId))}`
}

/** Refreshes the detail page a mutation just changed, if the key names one. */
function revalidateDetail(mediaId: string): void {
  const path = detailPath(mediaId)

  if (path) {
    revalidatePath(path)
  }
}

/**
 * ⚠️⚠️ **Never call this speculatively.** Not on page load, not on hover, not
 * from a prefetch, not "to warm a cache".
 *
 * `GET /download/media/:id/releases` is a GET that **writes upstream**. Radarr
 * and Sonarr will not surface releases for an unmonitored title, so the backend
 * borrows monitoring for the duration of the search and puts it back — a
 * caller that fires this on navigation mutates a real library as a side effect
 * of somebody *looking* at a page. It is also a genuine indexer sweep, 30s+,
 * with no cache behind it.
 *
 * It lives in this module, next to the mutations, rather than beside the
 * page's other reads, precisely so that constraint is impossible to miss.
 * `ReleasePicker` calls it from one place: a click on its own trigger.
 *
 * Deliberately **not** revalidating anything — it changes nothing on this
 * side, and a `revalidatePath` here would re-render the page that just
 * triggered it.
 */
export async function searchReleases(
  mediaId: string,
  query: ListReleasesQuery = {},
): Promise<ReleaseSearchResult> {
  const client = await getIdentifiedDownloadClient()

  try {
    const { releases } = await client.listReleases(mediaId, query)

    return { releases }
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] GET /download/media/:id/releases failed',
      error,
    )

    return { error: SEARCH_FAILED }
  }
}

/**
 * Grabs one release the user explicitly picked (spec §6).
 *
 * `input` is the *identity* of the pick (`guid`/`indexerId`, plus the
 * show-only `episodeId`/`seasonNumber` scope), not the release object — which
 * is all either service needs, and which means nothing the browser sends is
 * trusted beyond two opaque ids the backend re-resolves against its own search.
 *
 * ⚠️ The 409 branch is the flagged-bad refusal. `ReleasePicker` already
 * disables a flagged row rather than letting the user find out by clicking, so
 * this is the race case only.
 */
export async function grabRelease(
  mediaId: string,
  input: GrabReleaseInput,
): Promise<ReleaseActionResult> {
  // Outside the `try`, exactly as in `start-video-download.ts`: `headers()`
  // signals a static-generation bailout by throwing a value carrying a
  // `digest`, and this keeps the `try` wrapping precisely one call.
  const client = await getIdentifiedDownloadClient()

  let job: DownloadJob

  try {
    job = await client.grabRelease(mediaId, input)
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] POST /download/media/:id/releases/grab failed',
      error,
    )

    return {
      error:
        error instanceof DownloadApiError && error.status === 409
          ? GRAB_FLAGGED
          : GRAB_FAILED,
    }
  }

  revalidateDetail(mediaId)

  return { job }
}

/**
 * Swaps the file on disk for a different release — **one call, not a delete
 * followed by a grab**.
 *
 * That is the whole reason this endpoint exists rather than the UI sequencing
 * `deleteMediaFiles` and `grabRelease` itself: the backend deletes and grabs
 * as one action, so a failure can never leave the title with a deleted file
 * and no replacement. A client-side two-step would reintroduce exactly the
 * window the endpoint was built to close, and it would do so on a network the
 * user can close a tab on.
 */
export async function replaceRelease(
  mediaId: string,
  input: ReplaceReleaseInput,
): Promise<ReleaseActionResult> {
  const client = await getIdentifiedDownloadClient()

  let job: DownloadJob

  try {
    job = await client.replaceRelease(mediaId, input)
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] POST /download/media/:id/releases/replace failed',
      error,
    )

    return {
      error:
        error instanceof DownloadApiError && error.status === 409
          ? GRAB_FLAGGED
          : REPLACE_FAILED,
    }
  }

  revalidateDetail(mediaId)

  return { job }
}

/**
 * Reports a release as bad so this app stops picking it (spec §6).
 *
 * **Idempotent on `(mediaId, releaseGuid)`** — re-flagging returns the
 * original row rather than erroring, so a double-click is a success with the
 * same `badFile` in it, and the caller renders it as one. There is deliberately
 * no "already reported" branch here: the backend does not distinguish, and
 * inventing the distinction client-side would mean guessing.
 *
 * ⚠️ The one release route that *requires* identity server-side. A
 * `DownloadClient.localInstance` call would arrive without `X-Forwarded-User`
 * and come back 401 — which is why every call in this module goes through
 * `getIdentifiedDownloadClient()`.
 */
export async function flagBadFile(
  mediaId: string,
  input: FlagBadFileInput,
): Promise<BadFileActionResult> {
  const client = await getIdentifiedDownloadClient()

  let badFile: BadFile

  try {
    ;({ badFile } = await client.flagBadFile(mediaId, input))
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] POST /download/media/:id/bad-files failed',
      error,
    )

    return { error: FLAG_FAILED }
  }

  revalidateDetail(mediaId)

  return { badFile }
}

/** Removes a flag so this app can pick that release again. Returns the removed row. */
export async function unflagBadFile(
  mediaId: string,
  flagId: number,
): Promise<BadFileActionResult> {
  const client = await getIdentifiedDownloadClient()

  let badFile: BadFile

  try {
    ;({ badFile } = await client.unflagBadFile(mediaId, flagId))
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] DELETE /download/media/:id/bad-files/:flagId failed',
      error,
    )

    return { error: UNFLAG_FAILED }
  }

  revalidateDetail(mediaId)

  return { badFile }
}

/**
 * Deletes a title's files, scoped narrowest-first by `query` (`episodeId`,
 * then `seasonNumber`, then everything).
 *
 * ⚠️ Destructive and irreversible — it removes real files from
 * `/storage/media-library`. The scope is never inferred here: `DeleteConfirm`
 * builds the query from its own `DeleteScope` discriminant and names that scope
 * verbatim in the dialog, so what the user read and what this deletes are the
 * same value.
 *
 * ⚠️ Not files only for a whole title. A `movie` scope, and a `series` scope
 * with no season or episode, are Radarr's / Sonarr's real `DELETE` with
 * `deleteFiles=true`: the title leaves the library **and** the arr, and the
 * response says so with `removedFromLibrary`. A season or episode scope
 * deletes files and unmonitors — but it cascades up, so removing the last
 * downloaded episode of a season unmonitors the season, and removing the last
 * downloaded season removes the series. Whatever is removed can be requested
 * again later, which re-adds it. See "Monitoring cascades and full removal"
 * in `docs/features/download/backend.md`.
 *
 * Deleting zero files is a success, not an error: the caller asked for a state
 * and that state already held.
 */
export async function deleteMediaFiles(
  mediaId: string,
  query: DeleteMediaFilesQuery = {},
): Promise<DeleteMediaFilesResult> {
  const client = await getIdentifiedDownloadClient()

  let deletedCount: number

  try {
    ;({ deletedCount } = await client.deleteMediaFiles(mediaId, query))
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] DELETE /download/media/:id/files failed',
      error,
    )

    return { error: DELETE_FAILED }
  }

  revalidateDetail(mediaId)

  return { deletedCount }
}

/**
 * Lists what Radarr or Sonarr downloaded but refused to import (spec §7).
 *
 * The read behind the importer dialog: one entry per file upstream is holding
 * in "Downloaded - Waiting to Import", each carrying the `rejections` that
 * explain why it stalled and an `importable` flag saying whether committing it
 * is even allowed.
 *
 * Deliberately **not** revalidating: it is a read, and the dialog calls it on
 * open. A `revalidatePath` here would re-render the page underneath the dialog
 * that just asked for the list.
 *
 * A 404 is not special-cased. Unlike the two mutations, a missing queue row
 * here means the dialog simply has nothing to show, and the generic copy says
 * so without claiming an import was lost.
 */
export async function listImportCandidates(
  mediaId: string,
  query: ListImportCandidatesQuery = {},
): Promise<ImportCandidatesResult> {
  const client = await getIdentifiedDownloadClient()

  try {
    const { candidates } = await client.listImportCandidates(mediaId, query)

    return { candidates }
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error('[media-files] GET /download/media/:id/imports failed', error)

    return { error: IMPORT_LIST_FAILED }
  }
}

/**
 * Commits the candidates the user ticked, keyed by `paths` alone.
 *
 * The path is the commit key because it is the one thing upstream's
 * `ManualImport` command re-resolves against its own candidate list — nothing
 * else the dialog rendered is sent back or trusted.
 *
 * ⚠️ The 404 branch **still revalidates**. It means the queue row is gone —
 * another tab imported it, or the arr retried and succeeded on its own — so
 * the page the user is looking at is stale by definition, and leaving it
 * un-refreshed would keep showing a "needs attention" job that upstream
 * already resolved.
 */
export async function importFiles(
  mediaId: string,
  input: ImportFilesInput,
): Promise<ImportFilesResult> {
  const client = await getIdentifiedDownloadClient()

  let importedCount: number

  try {
    ;({ importedCount } = await client.importFiles(mediaId, input))
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] POST /download/media/:id/imports failed',
      error,
    )

    if (error instanceof DownloadApiError && error.status === 404) {
      revalidateDetail(mediaId)

      return { error: IMPORT_NOTHING }
    }

    return { error: IMPORT_FAILED }
  }

  revalidateDetail(mediaId)

  return { importedCount }
}

/**
 * Throws the stuck download away — the other way out of `needs_attention`, and
 * the destructive one.
 *
 * It removes every queue item in scope **and the client's files with them**, so
 * the bytes that were sitting there waiting are gone; the job is cancelled
 * rather than imported. Discarding nothing is a success, exactly as deleting
 * zero files is.
 *
 * ⚠️ Same 404-still-revalidates rule as {@link importFiles}, for the same
 * reason: the row being gone is precisely the case where the page is wrong.
 */
export async function discardImport(
  mediaId: string,
  query: DiscardImportQuery = {},
): Promise<DiscardImportResult> {
  const client = await getIdentifiedDownloadClient()

  let discardedCount: number

  try {
    ;({ discardedCount } = await client.discardImport(mediaId, query))
  } catch (error) {
    if (isFrameworkSignal(error)) {
      throw error
    }

    console.error(
      '[media-files] DELETE /download/media/:id/imports failed',
      error,
    )

    if (error instanceof DownloadApiError && error.status === 404) {
      revalidateDetail(mediaId)

      return { error: IMPORT_NOTHING }
    }

    return { error: DISCARD_FAILED }
  }

  revalidateDetail(mediaId)

  return { discardedCount }
}
