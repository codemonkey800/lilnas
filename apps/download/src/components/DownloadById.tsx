'use client'

import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { Chip, LinearProgress, Paper } from '@mui/material'
import _ from 'lodash'
import { useEffect, useState } from 'react'
import { match } from 'ts-pattern'

const PENDING_STATUSES = [
  DownloadJobStatus.Cancelling,
  DownloadJobStatus.Converting,
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Pending,
  DownloadJobStatus.Uploading,
] as const

export function DownloadById({
  getVideoJob,
  initialJob,
}: {
  getVideoJob: () => Promise<DownloadJob>
  initialJob: DownloadJob
}) {
  const [job, setJob] = useState(initialJob)
  const isPending =
    !!job?.status &&
    PENDING_STATUSES.includes(job.status as (typeof PENDING_STATUSES)[number])

  useEffect(() => {
    async function updateJob() {
      setJob(await getVideoJob())
    }

    if (!isPending) {
      return
    }

    const intervalId = setInterval(updateJob, 1000)
    return () => clearInterval(intervalId)
  }, [getVideoJob, isPending])

  return (
    <div className="flex flex-auto items-center justify-center p-4">
      <Paper className="w-full max-w-[800px]">
        {isPending && <LinearProgress variant="indeterminate" />}

        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Chip
              className={match(job?.status)
                .with(
                  DownloadJobStatus.Cancelled,
                  DownloadJobStatus.Failed,
                  () => '!bg-red-700',
                )
                .with(DownloadJobStatus.Completed, () => '!bg-green-700')
                .with(...PENDING_STATUSES, () => '!bg-yellow-700')
                .otherwise(() => '')}
              label={job && _.upperFirst(job.status)}
            />
            <Chip
              className={match(job?.type)
                .with(DownloadType.Video, () => '!bg-purple-700')
                .otherwise(() => '')}
              label={job && _.upperFirst(job.type)}
            />
          </div>

          <a
            className="text-xl md:text-2xl underline"
            href={job?.url}
            target="_blank"
            rel="noreferrer noorigin"
          >
            {job?.title || job?.url || '--'}
          </a>

          {job.timeRange && (
            <p className="text-gray-400">
              From {job.timeRange.start} to {job.timeRange.end}
            </p>
          )}

          {job?.downloadUrls &&
            job.downloadUrls.map((url, idx) => (
              <a
                className="text-purple-500"
                href={url}
                key={url}
                rel="noreferrer noorigin"
                target="_blank"
              >
                Download
                {(job.downloadUrls?.length ?? 0) > 1 ? ` ${idx + 1}` : ''}
              </a>
            ))}

          {job?.description && <p>{job.description}</p>}
        </div>
      </Paper>
    </div>
  )
}
