import { DownloadClient } from '@lilnas/utils/download/client'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { Chip, LinearProgress, Paper } from '@mui/material'
import _ from 'lodash'
import { match } from 'ts-pattern'

import { RefreshOnInterval } from './RefreshOnInterval'

const client = DownloadClient.localInstance

const PENDING_STATUSES = [
  DownloadJobStatus.Cancelling,
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Converting,
  DownloadJobStatus.Pending,
]

export async function DownloadById({ id }: { id: string }) {
  const job = await client.getVideoJob(id)
  const isPending = PENDING_STATUSES.includes(job.status)

  return (
    <div className="flex flex-auto items-center justify-center">
      {isPending && <RefreshOnInterval interval={1000} />}

      <Paper className="min-w-[600px] max-w-[600px]">
        {isPending && <LinearProgress variant="indeterminate" />}

        <div className="p-4 flex flex-col gap-3">
          <a
            className="text-2xl underline"
            href={job.url}
            target="_blank"
            rel="noreferrer noorigin"
          >
            {job.title || job.url}
          </a>

          {job.downloadUrls &&
            job.downloadUrls.map((url, idx) => (
              <a
                className="text text-purple-500"
                href={url}
                key={url}
                rel="noreferrer noorigin"
                target="_blank"
              >
                Download
                {(job.downloadUrls?.length ?? 0) > 1 ? ` ${idx + 1}` : ''}
              </a>
            ))}

          {job.description && <p>{job.description}</p>}

          <div className="flex items-center gap-2">
            <Chip
              className={match(job.status)
                .with(
                  DownloadJobStatus.Cancelled,
                  DownloadJobStatus.Failed,
                  () => '!bg-red-700',
                )
                .with(DownloadJobStatus.Completed, () => '!bg-green-700')
                .with(
                  DownloadJobStatus.Pending,
                  DownloadJobStatus.Downloading,
                  DownloadJobStatus.Cancelling,
                  () => '!bg-yellow-700',
                )
                .exhaustive()}
              label={_.upperFirst(job.status)}
            />
            <Chip
              className={match(job.type)
                .with(DownloadType.Video, () => '!bg-purple-700')
                .exhaustive()}
              label={_.upperFirst(job.type)}
            />
          </div>
        </div>
      </Paper>
    </div>
  )
}
