// Test setup file
beforeEach(() => {
  // Clear any timers and mocks before each test
  jest.clearAllTimers()
  jest.clearAllMocks()
})

afterEach(() => {
  // Restore any mocks after each test
  jest.restoreAllMocks()
})

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}
