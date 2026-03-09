import 'reflect-metadata'

// ---------------------------------------------------------------------------
// Global mock: src/db
// Prevents PostgreSQL pool creation on module load. Tests that need
// specific DB behaviour configure individual mock functions themselves.
// ---------------------------------------------------------------------------

jest.mock('src/db', () => ({
  db: {
    query: {
      users: { findFirst: jest.fn().mockResolvedValue(null) },
      accounts: { findFirst: jest.fn().mockResolvedValue(null) },
    },
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}))

// ---------------------------------------------------------------------------
// Global mock: src/media/clients
// Returns empty stub objects so service code can call getRadarrClient() /
// getSonarrClient() without env vars. Individual API functions are mocked
// at the @lilnas/media/* module level in each test file.
// ---------------------------------------------------------------------------

jest.mock('src/media/clients', () => ({
  getRadarrClient: jest.fn().mockReturnValue({}),
  getSonarrClient: jest.fn().mockReturnValue({}),
}))

// ---------------------------------------------------------------------------
// Global mock: src/media/search-results
// All DB-backed search-result helpers are replaced with no-op jest.fn()s.
// ---------------------------------------------------------------------------

jest.mock('src/media/search-results', () => ({
  recordMovieNotFound: jest.fn().mockResolvedValue(undefined),
  clearMovieSearchResult: jest.fn().mockResolvedValue(undefined),
  getMovieSearchResult: jest.fn().mockResolvedValue(null),
  recordEpisodesNotFound: jest.fn().mockResolvedValue(undefined),
  clearEpisodeSearchResult: jest.fn().mockResolvedValue(undefined),
  clearEpisodeSearchResultsBulk: jest.fn().mockResolvedValue(undefined),
  getShowSearchResults: jest.fn().mockResolvedValue(new Map()),
  clearAllShowSearchResults: jest.fn().mockResolvedValue(undefined),
}))
