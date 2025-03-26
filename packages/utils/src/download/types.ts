import { ChildProcessWithoutNullStreams } from 'child_process'
import { z } from 'zod'

import { CreateDownloadJobInputSchema, VideoInfoSchema } from './schema'

export enum DownloadType {
  Video = 'video',
}

export enum DownloadJobStatus {
  Cancelled = 'cancelled',
  Cancelling = 'cancelling',
  Cleaning = 'cleaning',
  Completed = 'completed',
  Converting = 'converting',
  Downloading = 'downloading',
  Failed = 'failed',
  Pending = 'pending',
  Uploading = 'uploading',
}

export type CreateDownloadJobInput = z.infer<
  typeof CreateDownloadJobInputSchema
>

export interface DownloadJob extends CreateDownloadJobInput {
  description?: string
  downloadUrls?: string[]
  file?: string
  id: string
  proc?: ChildProcessWithoutNullStreams
  status: DownloadJobStatus
  title?: string
  type: DownloadType
  url: string
}

export type GetDownloadJobResponse = Pick<
  DownloadJob,
  | 'description'
  | 'downloadUrls'
  | 'id'
  | 'status'
  | 'timeRange'
  | 'title'
  | 'type'
  | 'url'
>

export type VideoInfo = z.infer<typeof VideoInfoSchema>
