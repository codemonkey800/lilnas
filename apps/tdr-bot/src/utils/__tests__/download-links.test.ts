import { HumanMessage } from '@langchain/core/messages'
import { DownloadType } from '@lilnas/utils/download/types'

import {
  downloadLinks,
  escapeLinkText,
  selectionList,
  withDownloadLinks,
} from 'src/utils/download-links'

describe('download-links', () => {
  const originalDownloadUrl = process.env.DOWNLOAD_URL

  afterEach(() => {
    if (originalDownloadUrl === undefined) {
      delete process.env.DOWNLOAD_URL
    } else {
      process.env.DOWNLOAD_URL = originalDownloadUrl
    }
  })

  describe('downloadLinks', () => {
    it('defaults to the production site', () => {
      delete process.env.DOWNLOAD_URL

      expect(
        downloadLinks({ id: 'tmdb:603', type: DownloadType.Movie }),
      ).toEqual({
        activity: 'https://download.lilnas.io/activity',
        media: 'https://download.lilnas.io/movies/603',
      })
    })

    it('uses DOWNLOAD_URL when set, ignoring a trailing slash', () => {
      process.env.DOWNLOAD_URL = 'https://download.dev.lilnas.io/'

      expect(
        downloadLinks({ id: 'tvdb:81189', type: DownloadType.Show }),
      ).toEqual({
        activity: 'https://download.dev.lilnas.io/activity',
        media: 'https://download.dev.lilnas.io/shows/81189',
      })
    })

    it('links a video to its videos page by the bare row id', () => {
      delete process.env.DOWNLOAD_URL

      expect(
        downloadLinks({ id: 'video:V1StGXR8_Z5', type: DownloadType.Video })
          .media,
      ).toBe('https://download.lilnas.io/videos/V1StGXR8_Z5')
    })
  })

  describe('escapeLinkText', () => {
    it('escapes brackets and backslashes', () => {
      expect(escapeLinkText('[REC] \\ 2')).toBe('\\[REC\\] \\\\ 2')
    })

    it('strips emoji, which stop Discord rendering the link', () => {
      expect(
        escapeLinkText(
          "I don't remember this in CoD 🤯 #callofduty #nostalgia",
        ),
      ).toBe("I don't remember this in CoD #callofduty #nostalgia")
    })

    it('strips multi-codepoint emoji without leaving joiners behind', () => {
      expect(escapeLinkText('👨‍👩‍👧 Family 👍🏽 trip 🇯🇵 ❤️')).toBe('Family trip')
    })
  })

  describe('selectionList', () => {
    it('numbers each title and links it to its page', () => {
      delete process.env.DOWNLOAD_URL

      expect(
        selectionList([
          {
            media: { id: 'tmdb:603', type: DownloadType.Movie },
            title: 'The Matrix',
            details: '(1999) ⭐8.2',
          },
          {
            media: { id: 'tvdb:81189', type: DownloadType.Show },
            title: '[REC] 🎬',
          },
        ]),
      ).toBe(
        [
          '1. [The Matrix](<https://download.lilnas.io/movies/603>) (1999) ⭐8.2',
          '2. [\\[REC\\]](<https://download.lilnas.io/shows/81189>)',
        ].join('\n'),
      )
    })
  })

  describe('withDownloadLinks', () => {
    it('appends an activity link and a title link to the response', () => {
      delete process.env.DOWNLOAD_URL
      const response = new HumanMessage({ id: 'r1', content: 'Added it!' })

      const result = withDownloadLinks(
        response,
        { id: 'tmdb:603', type: DownloadType.Movie },
        'The Matrix',
      )

      expect(result.id).toBe('r1')
      expect(result.content).toBe(
        'Added it!\n\nFollow along on the [activity page](<https://download.lilnas.io/activity>), or open [The Matrix](<https://download.lilnas.io/movies/603>).',
      )
      // The model's message is left untouched.
      expect(response.content).toBe('Added it!')
    })
  })
})
