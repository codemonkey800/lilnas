import { Test, TestingModule } from '@nestjs/testing'

import {
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
} from 'src/media/types/radarr.types'
import {
  SeriesSearchResult,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import { testSelectionMethod } from 'src/media-operations/request-handling/__test-helpers__/selection-test-suite'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { SearchSelection } from 'src/schemas/search-selection'

describe('SelectionUtilities', () => {
  let service: SelectionUtilities

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SelectionUtilities],
    }).compile()

    service = module.get<SelectionUtilities>(SelectionUtilities)
  })

  // Test data factories
  const createMockMovie = (
    overrides?: Partial<MovieSearchResult>,
  ): MovieSearchResult => ({
    tmdbId: 12345,
    title: 'Test Movie',
    year: 2024,
    genres: [],
    status: RadarrMovieStatus.RELEASED,
    ...overrides,
  })

  const createMockLibraryMovie = (
    overrides?: Partial<MovieLibrarySearchResult>,
  ): MovieLibrarySearchResult => ({
    id: 1,
    title: 'Test Library Movie',
    year: 2024,
    tmdbId: 12345,
    hasFile: true,
    status: RadarrMovieStatus.RELEASED,
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
    monitored: true,
    qualityProfileId: 1,
    path: '/movies/test',
    added: '2024-01-01',
    rootFolderPath: '/movies',
    isAvailable: true,
    genres: [],
    ...overrides,
  })

  const createMockShow = (
    overrides?: Partial<SeriesSearchResult>,
  ): SeriesSearchResult => ({
    tvdbId: 67890,
    title: 'Test Show',
    titleSlug: 'test-show',
    year: 2023,
    status: SonarrSeriesStatus.CONTINUING,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [],
    genres: [],
    ended: false,
    ...overrides,
  })

  const createMockLibraryShow = (
    overrides?: Partial<{
      id: number
      tvdbId: number
      title: string
      year?: number
    }>,
  ): { id: number; tvdbId: number; title: string; year?: number } => ({
    id: 1,
    tvdbId: 67890,
    title: 'Library Show',
    year: 2023,
    ...overrides,
  })

  // Use shared test suite for all selection methods
  testSelectionMethod({
    methodName: 'findSelectedMovie',
    method: (selection, items) => service.findSelectedMovie(selection, items),
    createItem: createMockMovie,
    itemName: 'movie',
  })

  testSelectionMethod({
    methodName: 'findSelectedMovieFromLibrary',
    method: (selection, items) =>
      service.findSelectedMovieFromLibrary(selection, items),
    createItem: createMockLibraryMovie,
    itemName: 'library movie',
  })

  testSelectionMethod({
    methodName: 'findSelectedShow',
    method: (selection, items) => service.findSelectedShow(selection, items),
    createItem: createMockShow,
    itemName: 'show',
  })

  testSelectionMethod({
    methodName: 'findSelectedTvShowFromLibrary',
    method: (selection, items) =>
      service.findSelectedTvShowFromLibrary(selection, items),
    createItem: createMockLibraryShow,
    itemName: 'library show',
  })

  describe('Edge Cases (ISSUE-5)', () => {
    describe('Negative ordinals', () => {
      it('should default to first movie for negative ordinal', () => {
        const items = [
          createMockMovie({ year: 2020 }),
          createMockMovie({ year: 2021 }),
        ]
        const selection: SearchSelection = {
          selectionType: 'ordinal',
          value: '-1',
        }

        const result = service.findSelectedMovie(selection, items)

        expect(result).toEqual(items[0])
      })
    })

    describe('Non-numeric ordinals', () => {
      it('should default to first movie for alphabetic ordinal', () => {
        const items = [
          createMockMovie({ year: 2020 }),
          createMockMovie({ year: 2021 }),
        ]
        const selection: SearchSelection = {
          selectionType: 'ordinal',
          value: 'abc',
        }

        const result = service.findSelectedMovie(selection, items)

        expect(result).toEqual(items[0])
      })
    })

    describe('Zero as ordinal', () => {
      it('should default to first movie for zero ordinal', () => {
        const items = [
          createMockMovie({ year: 2020 }),
          createMockMovie({ year: 2021 }),
        ]
        const selection: SearchSelection = {
          selectionType: 'ordinal',
          value: '0',
        }

        const result = service.findSelectedMovie(selection, items)

        // parseInt('0') - 1 = -1, which fails index >= 0 check
        expect(result).toEqual(items[0])
      })

      it('should return null for zero ordinal with empty results', () => {
        const selection: SearchSelection = {
          selectionType: 'ordinal',
          value: '0',
        }

        const result = service.findSelectedMovie(selection, [])

        expect(result).toBeNull()
      })
    })

    describe('Float ordinals', () => {
      it('should truncate float ordinals', () => {
        const items = [
          createMockMovie({ year: 2020 }),
          createMockMovie({ year: 2021 }),
          createMockMovie({ year: 2022 }),
        ]
        const selection: SearchSelection = {
          selectionType: 'ordinal',
          value: '1.5',
        }

        const result = service.findSelectedMovie(selection, items)

        expect(result).toEqual(items[0])
      })
    })

    describe('Year with leading zeros', () => {
      it('should not match year with leading zeros', () => {
        const items = [
          createMockMovie({ year: 1999 }),
          createMockMovie({ year: 2000 }),
        ]
        const selection: SearchSelection = {
          selectionType: 'year',
          value: '01999',
        }

        const result = service.findSelectedMovie(selection, items)

        expect(result).toEqual(items[0])
      })
    })
  })
})
