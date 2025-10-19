import { YtdlpTestHelper } from 'src/ytdlp-update/__tests__/helpers/ytdlp-test.helper'
import { GitHubRelease } from 'src/ytdlp-update/types'

export const mockGitHubRelease: GitHubRelease = {
  tag_name: YtdlpTestHelper.MOCK_MODERATE_VERSION,
  name: `Release ${YtdlpTestHelper.MOCK_MODERATE_VERSION}`,
  published_at: '2024-01-15T12:00:00Z',
  assets: [
    {
      name: 'yt-dlp',
      browser_download_url:
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
      size: 12345678,
    },
    {
      name: 'yt-dlp.exe',
      browser_download_url:
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
      size: 23456789,
    },
  ],
}

export const mockOlderGitHubRelease: GitHubRelease = {
  tag_name: YtdlpTestHelper.MOCK_OLDER_VERSION,
  name: `Release ${YtdlpTestHelper.MOCK_OLDER_VERSION}`,
  published_at: '2024-01-10T12:00:00Z',
  assets: [
    {
      name: 'yt-dlp',
      browser_download_url:
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
      size: 12345678,
    },
  ],
}

export const mockNewerGitHubRelease: GitHubRelease = {
  tag_name: YtdlpTestHelper.MOCK_NEWER_VERSION,
  name: `Release ${YtdlpTestHelper.MOCK_NEWER_VERSION}`,
  published_at: '2024-02-01T12:00:00Z',
  assets: [
    {
      name: 'yt-dlp',
      browser_download_url:
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
      size: 12345678,
    },
  ],
}
