module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '!**/__tests__/setup.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          module: 'commonjs',
          moduleResolution: 'node',
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**/*',
    '!src/main.ts',
    '!src/bootstrap.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/lidarr-client$':
      '<rootDir>/../../packages/lidarr-client/src/index.ts',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
    '^@lilnas/media/radarr-next/client$':
      '<rootDir>/../../packages/media/src/radarr-next/client/index.ts',
    '^@lilnas/media/radarr-next$':
      '<rootDir>/../../packages/media/src/radarr-next/index.ts',
    '^@lilnas/media/sonarr/client$':
      '<rootDir>/../../packages/media/src/sonarr/client/index.ts',
    '^@lilnas/media/sonarr$':
      '<rootDir>/../../packages/media/src/sonarr/index.ts',
    '^@lilnas/token-client$':
      '<rootDir>/../../packages/token-client/src/index.ts',
  },
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
}
