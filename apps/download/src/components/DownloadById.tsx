'use client'

import { cns } from '@lilnas/utils/cns'
import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  isInProgressDownloadJobStatus,
  isVideo,
} from '@lilnas/utils/download/types'
import { Chip, LinearProgress, Paper } from '@mui/material'
import _ from 'lodash'
import { useState } from 'react'
import { match } from 'ts-pattern'

import { useDownloadJobSocket } from './use-download-job-socket'

export function DownloadById({ initialJob }: { initialJob: DownloadJob }) {
  const [job, setJob] = useState(initialJob)
  // Derived from the shared in-progress set rather than a hand-listed one -
  // the local copy this replaced was missing cleaning/importing/requested/
  // searching, so a job in `searching` rendered with no progress bar.
  const isPending = isInProgressDownloadJobStatus(job.status)
  const media = job.media
  const sourceUrl = isVideo(media) ? media.sourceUrl : undefined
  const downloadUrls = isVideo(media) ? media.downloadUrls : undefined

  useDownloadJobSocket(initialJob.id, isPending, setJob)

  return (
    <div className="flex flex-auto items-center justify-center p-4">
      <Paper className="w-full max-w-[800px]">
        {isPending && <LinearProgress variant="indeterminate" />}

        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Chip
              className={match(job.status)
                .with(
                  DownloadJobStatus.Cancelled,
                  DownloadJobStatus.Failed,
                  () => '!bg-red-700',
                )
                .with(DownloadJobStatus.Completed, () => '!bg-green-700')
                .when(isInProgressDownloadJobStatus, () => '!bg-yellow-700')
                .otherwise(() => '')}
              label={_.upperFirst(job.status)}
            />
            <Chip
              className={match(media.type)
                .with(DownloadType.Video, () => '!bg-purple-700')
                .otherwise(() => '')}
              label={_.upperFirst(media.type)}
            />
          </div>

          <a
            className="text-xl md:text-2xl underline"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noorigin"
          >
            {media.title || sourceUrl || '--'}
          </a>

          {job.status === DownloadJobStatus.Failed && job.error && (
            <p
              className={cns(
                'whitespace-pre-wrap rounded bg-red-950/40 p-3',
                'text-red-400',
              )}
            >
              {job.error}
            </p>
          )}

          {isVideo(media) && media.timeRange && (
            <p className="text-gray-400">
              From {media.timeRange.start} to {media.timeRange.end}
            </p>
          )}

          {downloadUrls?.map((url, idx) => (
            <a
              className="text-purple-500"
              href={url}
              key={url}
              rel="noreferrer noorigin"
              target="_blank"
            >
              Download
              {downloadUrls.length > 1 ? ` ${idx + 1}` : ''}
            </a>
          ))}

          {media.overview && <p>{media.overview}</p>}
        </div>
      </Paper>
    </div>
  )
}
