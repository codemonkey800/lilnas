import 'reflect-metadata'

// Minimal env vars so modules that call env() at import time don't throw
process.env['RADARR_URL'] = 'http://radarr.test'
process.env['RADARR_API_KEY'] = 'test-radarr-key'
process.env['SONARR_URL'] = 'http://sonarr.test'
process.env['SONARR_API_KEY'] = 'test-sonarr-key'
process.env['TOKEN_SERVICE_URL'] = 'http://token.test'

// Mock Radarr API module so all exported functions become jest.fn()
jest.mock('@lilnas/media/radarr-next')

// Mock Sonarr API module
jest.mock('@lilnas/media/sonarr')

// Mock TokenClient so validate() is controllable per test
jest.mock('@lilnas/token-client')
