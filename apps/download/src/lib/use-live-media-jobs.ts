'use client'

import type { DownloadJob } from '@lilnas/utils/download/types'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { mergeLiveMediaJobs } from 'src/components/detail/job-state'
import { useJobEvents } from 'src/lib/use-job-events'

/**
 * A movie or show page's jobs, kept current off the download gateway.
 *
 * `jobs` is `MediaDetailResponse.jobs` from the server render, which is both
 * the starting truth and the set of ids the subscription listens for. A job
 * this page creates (the Download button, a grabbed release) reaches that list
 * through the server action's own `revalidatePath`, and the interest follows.
 *
 * When a job lands, this asks the router for a fresh server render. That
 * refresh is what brings in the file, the Emby link and the current release,
 * none of which ride on a job frame. Until it arrives, `mergeLiveMediaJobs`
 * holds the job at `importing`.
 *
 * The effect keys on the landed ids, so one landing refreshes once. The
 * refreshed render carries the job as `completed`, which empties the list.
 */
export function useLiveMediaJobs(jobs: readonly DownloadJob[]): DownloadJob[] {
  const router = useRouter()
  const { jobs: live } = useJobEvents({
    jobIds: jobs.map(job => job.id),
  })

  const merged = mergeLiveMediaJobs(jobs, live)
  const landedKey = merged.landed.join(',')

  useEffect(() => {
    if (landedKey) {
      router.refresh()
    }
  }, [landedKey, router])

  return merged.jobs
}
