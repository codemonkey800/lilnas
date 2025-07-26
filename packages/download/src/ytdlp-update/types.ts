export interface GitHubRelease {
  tag_name: string
  name: string
  published_at: string
  assets: GitHubAsset[]
}

export interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  canUpdate: boolean
  reason?: string
}

export interface UpdateResult {
  success: boolean
  previousVersion: string
  newVersion: string
  error?: string
}

export enum UpdateStatus {
  Checking = 'checking',
  Downloading = 'downloading',
  Installing = 'installing',
  Testing = 'testing',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}
