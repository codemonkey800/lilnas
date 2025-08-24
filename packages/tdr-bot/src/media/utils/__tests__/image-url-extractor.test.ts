/**
 * @fileoverview Tests for Image URL Extraction Utilities
 */

import type { RadarrMovie } from 'src/media/clients/radarr.client'
import {
  convertToAbsoluteUrl,
  extractPosterUrl,
  getRadarrBaseUrl,
  isValidUrl,
} from 'src/media/utils/image-url-extractor'

describe('Image URL Extraction Utilities', () => {
  describe('isValidUrl', () => {
    it('should validate HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true)
      expect(isValidUrl('https://example.com')).toBe(true)
      expect(isValidUrl('https://image.tmdb.org/t/p/original/abc.jpg')).toBe(
        true,
      )
    })

    it('should reject invalid URLs', () => {
      expect(isValidUrl('invalid-url')).toBe(false)
      expect(isValidUrl('/relative/path')).toBe(false)
      expect(isValidUrl('ftp://example.com')).toBe(false)
      expect(isValidUrl('')).toBe(false)
    })
  })

  describe('convertToAbsoluteUrl', () => {
    it('should convert relative URLs to absolute', () => {
      const baseUrl = 'http://radarr.localhost'
      const relativeUrl = '/MediaCoverProxy/123/poster.jpg'
      const expected = 'http://radarr.localhost/MediaCoverProxy/123/poster.jpg'

      expect(convertToAbsoluteUrl(relativeUrl, baseUrl)).toBe(expected)
    })

    it('should handle base URLs with trailing slashes', () => {
      const baseUrl = 'http://radarr.localhost/'
      const relativeUrl = '/MediaCoverProxy/123/poster.jpg'
      const expected = 'http://radarr.localhost/MediaCoverProxy/123/poster.jpg'

      expect(convertToAbsoluteUrl(relativeUrl, baseUrl)).toBe(expected)
    })

    it('should handle relative URLs without leading slashes', () => {
      const baseUrl = 'http://radarr.localhost'
      const relativeUrl = 'MediaCoverProxy/123/poster.jpg'
      const expected = 'http://radarr.localhost/MediaCoverProxy/123/poster.jpg'

      expect(convertToAbsoluteUrl(relativeUrl, baseUrl)).toBe(expected)
    })

    it('should return null for invalid results', () => {
      expect(convertToAbsoluteUrl('invalid', 'not-a-url')).toBe(null)
    })
  })

  describe('getRadarrBaseUrl', () => {
    const originalEnv = process.env.RADARR_URL

    afterEach(() => {
      process.env.RADARR_URL = originalEnv
    })

    it('should return RADARR_URL from environment', () => {
      process.env.RADARR_URL = 'http://radarr.localhost'
      expect(getRadarrBaseUrl()).toBe('http://radarr.localhost')
    })

    it('should remove trailing slash from RADARR_URL', () => {
      process.env.RADARR_URL = 'http://radarr.localhost/'
      expect(getRadarrBaseUrl()).toBe('http://radarr.localhost')
    })

    it('should return null when RADARR_URL is not set', () => {
      delete process.env.RADARR_URL
      expect(getRadarrBaseUrl()).toBe(null)
    })
  })

  describe('extractPosterUrl', () => {
    const mockMovie: RadarrMovie = {
      id: 1,
      title: 'Test Movie',
      titleSlug: 'test-movie',
      year: 2023,
      tmdbId: 12345,
      monitored: true,
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      downloaded: false,
      status: 'wanted',
    }

    it('should prioritize remotePoster over other options', () => {
      const movieWithRemotePoster: RadarrMovie = {
        ...mockMovie,
        remotePoster: 'https://image.tmdb.org/t/p/original/abc.jpg',
        posterUrl: '/MediaCoverProxy/123/poster.jpg',
        images: [
          {
            coverType: 'poster',
            url: '/MediaCoverProxy/123/poster.jpg',
            remoteUrl: 'https://image.tmdb.org/t/p/original/xyz.jpg',
          },
        ],
      }

      const result = extractPosterUrl(movieWithRemotePoster)

      expect(result.imageUrl).toBe(
        'https://image.tmdb.org/t/p/original/abc.jpg',
      )
      expect(result.source).toBe('remotePoster')
    })

    it('should use images array when remotePoster is not available', () => {
      const movieWithImages: RadarrMovie = {
        ...mockMovie,
        posterUrl: '/MediaCoverProxy/123/poster.jpg',
        images: [
          {
            coverType: 'poster',
            url: '/MediaCoverProxy/123/poster.jpg',
            remoteUrl: 'https://image.tmdb.org/t/p/original/xyz.jpg',
          },
        ],
      }

      const result = extractPosterUrl(movieWithImages)

      expect(result.imageUrl).toBe(
        'https://image.tmdb.org/t/p/original/xyz.jpg',
      )
      expect(result.source).toBe('images_remoteUrl')
    })

    it('should convert relative posterUrl to absolute when baseUrl provided', () => {
      const movieWithRelativePoster: RadarrMovie = {
        ...mockMovie,
        posterUrl: '/MediaCoverProxy/123/poster.jpg',
      }

      const result = extractPosterUrl(movieWithRelativePoster, {
        radarrBaseUrl: 'http://radarr.localhost',
      })

      expect(result.imageUrl).toBe(
        'http://radarr.localhost/MediaCoverProxy/123/poster.jpg',
      )
      expect(result.source).toBe('posterUrl_relative')
    })

    it('should handle absolute posterUrl', () => {
      const movieWithAbsolutePoster: RadarrMovie = {
        ...mockMovie,
        posterUrl: 'https://example.com/poster.jpg',
      }

      const result = extractPosterUrl(movieWithAbsolutePoster)

      expect(result.imageUrl).toBe('https://example.com/poster.jpg')
      expect(result.source).toBe('posterUrl_absolute')
    })

    it('should return null when no valid image URL found', () => {
      const movieWithoutImages: RadarrMovie = {
        ...mockMovie,
        posterUrl: '/relative-url-without-base',
      }

      const result = extractPosterUrl(movieWithoutImages)

      expect(result.imageUrl).toBe(null)
      expect(result.source).toBe('none')
    })

    it('should include debug information when requested', () => {
      const movieWithRemotePoster: RadarrMovie = {
        ...mockMovie,
        remotePoster: 'https://image.tmdb.org/t/p/original/abc.jpg',
        images: [
          {
            coverType: 'poster',
            url: '/MediaCoverProxy/123/poster.jpg',
            remoteUrl: 'https://image.tmdb.org/t/p/original/xyz.jpg',
          },
        ],
      }

      const result = extractPosterUrl(movieWithRemotePoster, {
        debug: true,
      })

      expect(result.debug).toBeDefined()
      expect(result.debug?.remotePosterUrl).toBe(
        'https://image.tmdb.org/t/p/original/abc.jpg',
      )
    })

    it('should prefer poster cover type over other types', () => {
      const movieWithMultipleImages: RadarrMovie = {
        ...mockMovie,
        images: [
          {
            coverType: 'fanart',
            url: '/MediaCoverProxy/123/fanart.jpg',
            remoteUrl: 'https://image.tmdb.org/t/p/original/fanart.jpg',
          },
          {
            coverType: 'poster',
            url: '/MediaCoverProxy/123/poster.jpg',
            remoteUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
          },
        ],
      }

      const result = extractPosterUrl(movieWithMultipleImages)

      expect(result.imageUrl).toBe(
        'https://image.tmdb.org/t/p/original/poster.jpg',
      )
      expect(result.source).toBe('images_remoteUrl')
    })

    it('should fall back to any image with remoteUrl if no poster type found', () => {
      const movieWithNonPosterImages: RadarrMovie = {
        ...mockMovie,
        images: [
          {
            coverType: 'fanart',
            url: '/MediaCoverProxy/123/fanart.jpg',
            remoteUrl: 'https://image.tmdb.org/t/p/original/fanart.jpg',
          },
        ],
      }

      const result = extractPosterUrl(movieWithNonPosterImages)

      expect(result.imageUrl).toBe(
        'https://image.tmdb.org/t/p/original/fanart.jpg',
      )
      expect(result.source).toBe('images_remoteUrl')
    })
  })
})
