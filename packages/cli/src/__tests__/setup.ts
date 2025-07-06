/**
 * Jest test setup file
 * This file is executed before each test file is run
 */

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}

// Mock process.exit to prevent tests from exiting
const originalExit = process.exit
process.exit = jest.fn() as unknown as typeof process.exit

// Restore original process.exit after each test
afterEach(() => {
  jest.clearAllMocks()
  process.exit = originalExit
})
