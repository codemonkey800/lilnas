import { DownloadJob, isVideoDownloadJob } from '@lilnas/utils/download/types'

/**
 * The single implementation of the spec rule (spec §Core Concepts, §10, §11):
 *
 *   showTrueRequester = job.type !== 'video' || !job.hiddenAttribution || viewer.isAdmin
 *
 * Movies/shows are always attributed — there's no hiding toggle for them by
 * design. Every production call site (`DownloadStateService.broadcastJobEvent`
 * for WS, and each of `DownloadController`'s three serializers for REST)
 * goes through `projectJobForViewer` below rather than hand-rolling the
 * branch itself; this function is exported separately because it's the
 * directly-tested expression of the spec rule, not because anything calls
 * it directly.
 */
export function showTrueRequester(job: DownloadJob, isAdmin: boolean): boolean {
  if (!isVideoDownloadJob(job)) return true
  return !job.hiddenAttribution || isAdmin
}

/**
 * Returns a copy of `job` safe to send to a viewer with the given admin
 * status. `hiddenAttribution` itself is preserved in both variants — regular
 * users need it to render the hidden-attribution UI treatment, and admins
 * need it to know a record *is* hidden from everyone else. Only `requester`
 * is masked.
 */
export function projectJobForViewer<T extends DownloadJob>(
  job: T,
  isAdmin: boolean,
): T {
  return showTrueRequester(job, isAdmin) ? job : { ...job, requester: null }
}
