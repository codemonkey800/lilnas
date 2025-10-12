// ============================================================================
// Mock State Interface
// ============================================================================

export interface MockState {
  setUserMovieContext: jest.Mock
  clearUserMovieContext: jest.Mock
  setUserMovieDeleteContext: jest.Mock
  clearUserMovieDeleteContext: jest.Mock
  setUserTvShowContext: jest.Mock
  clearUserTvShowContext: jest.Mock
  setUserTvShowDeleteContext: jest.Mock
  clearUserTvShowDeleteContext: jest.Mock
}

// ============================================================================
// State Factory
// ============================================================================

export function createMockState(): MockState {
  return {
    setUserMovieContext: jest.fn(),
    clearUserMovieContext: jest.fn(),
    setUserMovieDeleteContext: jest.fn(),
    clearUserMovieDeleteContext: jest.fn(),
    setUserTvShowContext: jest.fn(),
    clearUserTvShowContext: jest.fn(),
    setUserTvShowDeleteContext: jest.fn(),
    clearUserTvShowDeleteContext: jest.fn(),
  }
}

// ============================================================================
// Context Factory Functions
// ============================================================================

export function createMockMovieContext(overrides?: Record<string, unknown>) {
  return {
    type: 'movie' as const,
    searchResults: [],
    query: 'test query',
    timestamp: Date.now(),
    isActive: true,
    ...overrides,
  }
}

export function createMockMovieDeleteContext(
  overrides?: Record<string, unknown>,
) {
  return {
    type: 'movieDelete' as const,
    searchResults: [],
    query: 'test query',
    timestamp: Date.now(),
    isActive: true,
    ...overrides,
  }
}

export function createMockTvShowContext(overrides?: Record<string, unknown>) {
  return {
    type: 'tvShow' as const,
    searchResults: [],
    query: 'test query',
    timestamp: Date.now(),
    isActive: true,
    originalSearchSelection: undefined,
    originalTvSelection: undefined,
    ...overrides,
  }
}

export function createMockTvShowDeleteContext(
  overrides?: Record<string, unknown>,
) {
  return {
    type: 'tvShowDelete' as const,
    searchResults: [],
    query: 'test query',
    timestamp: Date.now(),
    isActive: true,
    originalSearchSelection: undefined,
    originalTvSelection: undefined,
    ...overrides,
  }
}
