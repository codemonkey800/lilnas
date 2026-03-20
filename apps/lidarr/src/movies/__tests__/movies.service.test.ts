import {
  deleteApiV3MoviefileById,
  getApiV3Movie,
  getApiV3Moviefile,
} from '@lilnas/media/radarr-next'
import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { RADARR_CLIENT } from 'src/media/clients'
import { MoviesService } from 'src/movies/movies.service'

// All @lilnas/media/* functions are mocked globally in setup.ts
const mockGetApiV3Movie = getApiV3Movie as jest.MockedFunction<
  typeof getApiV3Movie
>
const mockGetApiV3Moviefile = getApiV3Moviefile as jest.MockedFunction<
  typeof getApiV3Moviefile
>
const mockDeleteApiV3MoviefileById =
  deleteApiV3MoviefileById as jest.MockedFunction<
    typeof deleteApiV3MoviefileById
  >

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiOk<T>(data: T): any {
  return { data }
}

function makeMovie(overrides = {}) {
  return {
    id: 1,
    tmdbId: 100,
    title: 'Test Movie',
    year: 2024,
    monitored: true,
    images: [],
    ...overrides,
  }
}

function makeMovieFile(overrides = {}) {
  return {
    id: 10,
    movieId: 1,
    relativePath: 'Test.Movie.2024.mkv',
    size: 5_000_000_000,
    quality: { quality: { name: '1080p' } },
    dateAdded: '2024-01-01',
    ...overrides,
  }
}

describe('MoviesService', () => {
  let service: MoviesService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MoviesService, { provide: RADARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get(MoviesService)
  })

  // ---------------------------------------------------------------------------
  // getMovie
  // ---------------------------------------------------------------------------

  describe('getMovie', () => {
    it('returns movie detail with files when movie exists', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockGetApiV3Moviefile.mockResolvedValue(
        apiOk([makeMovieFile({ id: 10 })]),
      )

      const result = await service.getMovie(100)

      expect(result.tmdbId).toBe(100)
      expect(result.title).toBe('Test Movie')
      expect(result.files).toHaveLength(1)
      expect(result.files[0]?.id).toBe(10)
    })

    it('throws NotFoundException when movie not found in Radarr', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([]))

      await expect(service.getMovie(999)).rejects.toThrow(NotFoundException)
      expect(mockGetApiV3Moviefile).not.toHaveBeenCalled()
    })

    it('returns empty files array when movie has no files', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockGetApiV3Moviefile.mockResolvedValue(apiOk([]))

      const result = await service.getMovie(100)

      expect(result.files).toEqual([])
    })

    it('skips file fetch when movie has no id', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([{ ...makeMovie(), id: undefined }]),
      )

      const result = await service.getMovie(100)

      expect(mockGetApiV3Moviefile).not.toHaveBeenCalled()
      expect(result.files).toEqual([])
    })

    it('maps status to downloaded when movie has file', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([{ ...makeMovie(), hasFile: true }]),
      )
      mockGetApiV3Moviefile.mockResolvedValue(apiOk([]))

      const result = await service.getMovie(100)

      expect(result.status).toBe('downloaded')
    })

    it('maps status to missing when movie has no file', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([{ ...makeMovie(), hasFile: false }]),
      )
      mockGetApiV3Moviefile.mockResolvedValue(apiOk([]))

      const result = await service.getMovie(100)

      expect(result.status).toBe('missing')
    })

    it('extracts poster and fanart image URLs', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([
          makeMovie({
            images: [
              {
                coverType: 'poster',
                remoteUrl: 'https://img.example.com/poster.jpg',
              },
              {
                coverType: 'fanart',
                remoteUrl: 'https://img.example.com/fanart.jpg',
              },
            ],
          }),
        ]),
      )
      mockGetApiV3Moviefile.mockResolvedValue(apiOk([]))

      const result = await service.getMovie(100)

      expect(result.posterUrl).toBe('https://img.example.com/poster.jpg')
      expect(result.fanartUrl).toBe('https://img.example.com/fanart.jpg')
    })

    it('returns null image URLs when no images present', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie({ images: [] })]))
      mockGetApiV3Moviefile.mockResolvedValue(apiOk([]))

      const result = await service.getMovie(100)

      expect(result.posterUrl).toBeNull()
      expect(result.fanartUrl).toBeNull()
    })

    it('includes file quality name in file info', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockGetApiV3Moviefile.mockResolvedValue(
        apiOk([
          makeMovieFile({
            id: 10,
            quality: { quality: { name: 'Bluray-1080p' } },
          }),
        ]),
      )

      const result = await service.getMovie(100)

      expect(result.files[0]?.quality).toBe('Bluray-1080p')
    })
  })

  // ---------------------------------------------------------------------------
  // deleteMovieFile
  // ---------------------------------------------------------------------------

  describe('deleteMovieFile', () => {
    it('deletes the file when fileId belongs to the movie', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockGetApiV3Moviefile.mockResolvedValue(
        apiOk([makeMovieFile({ id: 10 })]),
      )
      mockDeleteApiV3MoviefileById.mockResolvedValue(apiOk(undefined))

      await expect(service.deleteMovieFile(100, 10)).resolves.toBeUndefined()

      expect(mockDeleteApiV3MoviefileById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 10 } }),
      )
    })

    it('throws NotFoundException when movie not found in Radarr', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([]))

      await expect(service.deleteMovieFile(999, 10)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockGetApiV3Moviefile).not.toHaveBeenCalled()
      expect(mockDeleteApiV3MoviefileById).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when movie has no id', async () => {
      mockGetApiV3Movie.mockResolvedValue(
        apiOk([{ ...makeMovie(), id: undefined }]),
      )

      await expect(service.deleteMovieFile(100, 10)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException (IDOR guard) when fileId does not belong to this movie', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      // Movie only has file id=10; caller tries to delete file id=999 (different movie)
      mockGetApiV3Moviefile.mockResolvedValue(
        apiOk([makeMovieFile({ id: 10 })]),
      )

      await expect(service.deleteMovieFile(100, 999)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockDeleteApiV3MoviefileById).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when no files exist for the movie', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockGetApiV3Moviefile.mockResolvedValue(apiOk([]))

      await expect(service.deleteMovieFile(100, 10)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockDeleteApiV3MoviefileById).not.toHaveBeenCalled()
    })

    it('throws NotFoundException and logs when delete API call fails', async () => {
      mockGetApiV3Movie.mockResolvedValue(apiOk([makeMovie()]))
      mockGetApiV3Moviefile.mockResolvedValue(
        apiOk([makeMovieFile({ id: 10 })]),
      )
      mockDeleteApiV3MoviefileById.mockRejectedValue(
        new Error('Radarr unavailable'),
      )

      await expect(service.deleteMovieFile(100, 10)).rejects.toThrow(
        NotFoundException,
      )
      // Error message should NOT expose upstream details
      await service.deleteMovieFile(100, 10).catch(err => {
        expect((err as Error).message).not.toContain('Radarr unavailable')
      })
    })
  })
})
