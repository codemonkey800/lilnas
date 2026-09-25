'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useTransition } from 'react'

import type { JobAction } from 'src/components/detail/job-actions'
import { Button } from 'src/components/ui/button'

/** `video-detail.pug`'s `not downloaded` frame. */
export const VIDEO_DOWNLOAD_LABEL = 'Download'

export type VideoDownloadButtonProps = {
  className?: string
  /**
   * The attempt whose source is asked for again — the newest one. Every
   * attempt at a video names the same `sourceUrl` and `timeRange`, so which
   * one this is only decides whose `hiddenAttribution` carries across; see
   * `retryVideoJob`.
   */
  jobId: string
  /**
   * `retryVideoJob` — a fresh `POST /download/videos` for the same source.
   * It mints a **new** attempt rather than reopening this one, so the
   * attempt it names keeps whatever outcome it finished on.
   */
  onDownload: JobAction
}

/**
 * "Fetch this video again" — the video page's one way back to a file once
 * there is none: after its Delete, after a failure, after a cancel.
 *
 * Its own client component rather than a press handler inside `VideoDetail`,
 * which stays hook-free so it renders in a test without a provider, and whose
 * module a server page imports `VideoDetailShell` from.
 *
 * `aria-disabled` while the request is out, which `Button` turns into a
 * swallowed click — a second press would mint a second attempt. Nothing is
 * shown on failure: `retryVideoJob` is a `JobAction`, which logs and returns,
 * and the page still reading `not downloaded` with this button up is the
 * honest result.
 */
export function VideoDownloadButton({
  className,
  jobId,
  onDownload,
}: VideoDownloadButtonProps): JSX.Element {
  const [pending, startTransition] = useTransition()

  function download(): void {
    startTransition(async () => {
      await onDownload(jobId)
    })
  }

  return (
    <Button
      aria-disabled={pending || undefined}
      className={cns(className)}
      iconEnd="download"
      onClick={download}
      variant="outline"
    >
      {VIDEO_DOWNLOAD_LABEL}
    </Button>
  )
}
