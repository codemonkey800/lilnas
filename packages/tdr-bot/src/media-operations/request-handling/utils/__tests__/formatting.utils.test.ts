import {
  formatFileSize,
  formatMediaAsJson,
  formatTimeRemaining,
} from 'src/media-operations/request-handling/utils/formatting.utils'

describe('FormattingUtilities', () => {
  describe('formatFileSize', () => {
    it('should format file sizes across all units', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(500)).toBe('500 B')
      expect(formatFileSize(1023)).toBe('1023 B')
      expect(formatFileSize(1024 * 1024)).toBe('1 MB')
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TB')
      expect(formatFileSize(2.3 * 1024 * 1024 * 1024 * 1024)).toBe('2.3 TB')
    })
  })

  describe('formatTimeRemaining', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-01-01T12:00:00Z'))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should return "Soon" for past times', () => {
      const pastTime = new Date('2024-01-01T11:00:00Z').toISOString()
      expect(formatTimeRemaining(pastTime)).toBe('Soon')
    })

    it('should format future times with hours and minutes', () => {
      const futureTime = new Date('2024-01-01T14:30:00Z').toISOString()
      expect(formatTimeRemaining(futureTime)).toBe('2h 30m')
    })

    it('should handle invalid date strings gracefully', () => {
      const result = formatTimeRemaining('invalid-date')
      expect(typeof result).toBe('string')
    })
  })

  describe('formatMediaAsJson', () => {
    it('should format empty array', () => {
      expect(formatMediaAsJson([])).toBe('[]')
    })

    it('should format single item with all fields', () => {
      const items = [
        {
          title: 'Test Movie',
          year: 2024,
          tmdbId: 12345,
          hasFile: false,
          genres: ['Action', 'Drama'],
          rating: 8.5,
          overview: 'A test movie',
          status: 'released',
          monitored: true,
          id: 1,
        },
      ]

      const result = JSON.parse(formatMediaAsJson(items))
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        title: 'Test Movie',
        year: 2024,
        hasFile: false,
        tmdbId: 12345,
        genres: ['Action', 'Drama'],
        rating: 8.5,
        overview: 'A test movie',
        status: 'released',
        monitored: true,
        id: 1,
      })
    })

    it('should format multiple items including tvdbId mapping', () => {
      const items = [
        { title: 'Movie 1', year: 2024, tmdbId: 1 },
        { title: 'Movie 2', year: 2023, tmdbId: 2 },
        { title: 'Show 1', year: 2022, tvdbId: 3 },
      ]

      const result = JSON.parse(formatMediaAsJson(items))
      expect(result).toHaveLength(3)
      expect(result[0].title).toBe('Movie 1')
      expect(result[1].title).toBe('Movie 2')
      expect(result[2].title).toBe('Show 1')
      expect(result[2].tmdbId).toBe(3)
    })
  })
})
