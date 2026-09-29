import { DownloadApiError } from '@lilnas/utils/download/client'

import { downloadApiErrorMessage } from 'src/utils/download-api-error'

describe('downloadApiErrorMessage', () => {
  it("uses the server's message from a Nest error body", () => {
    const error = new DownloadApiError(400, 'Bad Request', {
      statusCode: 400,
      message: 'Radarr has no "Up to 4K" quality profile',
      error: 'Bad Request',
    })

    expect(downloadApiErrorMessage(error)).toBe(
      'Radarr has no "Up to 4K" quality profile',
    )
  })

  it('joins a list of validation messages', () => {
    const error = new DownloadApiError(400, 'Bad Request', {
      message: ['tmdbId must be positive', '', 'qualityTier is invalid'],
    })

    expect(downloadApiErrorMessage(error)).toBe(
      'tmdbId must be positive; qualityTier is invalid',
    )
  })

  it('falls back to the status line when the body has no message', () => {
    const error = new DownloadApiError(502, 'Bad Gateway', undefined)

    expect(downloadApiErrorMessage(error)).toBe(
      'Download API request failed with 502 Bad Gateway',
    )
  })

  it('falls back to the status line when the message is blank', () => {
    const error = new DownloadApiError(500, 'Internal Server Error', {
      message: '   ',
    })

    expect(downloadApiErrorMessage(error)).toBe(
      'Download API request failed with 500 Internal Server Error',
    )
  })

  it("uses any other error's own message", () => {
    expect(downloadApiErrorMessage(new TypeError('fetch failed'))).toBe(
      'fetch failed',
    )
  })
})
