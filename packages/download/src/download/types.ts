import { DownloadJob } from '@lilnas/utils/download/types'

export interface DownloadStepOptions {
  action: string
  id: string
  job: DownloadJob
}
