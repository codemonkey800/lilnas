import { DownloadJob, DownloadType } from '@lilnas/utils/download/types'

/**
 * The single implementation of the spec rule (spec §Core Concepts, §10, §11):
 *
 *   showTrueRequester = media.type !== 'video' || !hiddenAttribution || viewer.isAdmin
 *
 * Movies/shows are always attributed — there's no hiding toggle for them by
 * design. Kept as an explicit media-type branch rather than folded into the
 * `hiddenAttribution` flag alone, because that branch *is* the spec rule.
 *
 * Takes the two fields rather than a whole job so the gallery's grouped
 * rows — which have a `(type, media_id)` pair and a last-requester, but no
 * `DownloadJob` — go through the same rule instead of re-deriving it.
 */
export function showTrueAttribution(
  type: DownloadType,
  hiddenAttribution: boolean,
  isAdmin: boolean,
): boolean {
  if (type !== DownloadType.Video) return true
  return !hiddenAttribution || isAdmin
}

/**
 * `showTrueAttribution` for a full job. Exported separately because it's the
 * directly-tested expression of the spec rule, not because anything calls it
 * outside `projectJobForViewer` below.
 */
export function showTrueRequester(job: DownloadJob, isAdmin: boolean): boolean {
  return showTrueAttribution(job.media.type, job.hiddenAttribution, isAdmin)
}

/**
 * Returns a copy of `job` safe to send to a viewer with the given admin
 * status. `hiddenAttribution` itself is preserved in both variants — regular
 * users need it to render the hidden-attribution UI treatment, and admins
 * need it to know a record *is* hidden from everyone else. Only `requester`
 * is masked.
 *
 * Now that the domain type *is* the wire type, this is the entire read-path
 * transform — there is no serializer layer left. Every production call site
 * (`DownloadStateService.broadcastJobEvent` for WS, `DownloadController` for
 * REST) goes through here.
 */
export function projectJobForViewer(
  job: DownloadJob,
  isAdmin: boolean,
): DownloadJob {
  return showTrueRequester(job, isAdmin) ? job : { ...job, requester: null }
}
