import { DownloadJobRecord } from '@lilnas/utils/download/types'

export interface DownloadStepOptions {
  action: string
  id: string
  job: DownloadJobRecord
}
