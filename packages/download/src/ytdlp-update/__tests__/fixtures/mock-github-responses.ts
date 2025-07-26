import { GitHubRelease } from 'src/ytdlp-update/types'

export const mockGitHubRelease: GitHubRelease = {
  tag_name: '2024.1.15',
  name: 'Release 2024.1.15',
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
  tag_name: '2024.1.10',
  name: 'Release 2024.1.10',
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
  tag_name: '2024.2.1',
  name: 'Release 2024.2.1',
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
