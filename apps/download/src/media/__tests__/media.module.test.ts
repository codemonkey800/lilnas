// nanoid v5 ships ESM-only; see the other test files in this directory for
// why this must be mocked before anything transitively imports it
// (DownloadModule -> DownloadController -> MediaDownloadService -> nanoid).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { Module } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { NestMinioModule } from 'nestjs-minio'

import { DbModule } from 'src/db/db.module'
import { DownloadController } from 'src/download/download.controller'
import { DownloadModule } from 'src/download/download.module'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

// DownloadModule <-> MediaModule is a genuine circular module dependency
// (see download.module.ts and media.module.ts for why), resolved with
// forwardRef() on both sides. Every other test in this unit mocks
// RadarrService/SonarrService/DownloadStateService directly, which sidesteps
// real module resolution entirely - this test is the one place that boots
// the actual module graph (including the forwardRef cycle) to prove NestJS
// can actually wire it up, not just that the mocked units behave correctly
// in isolation. DbModule is @Global(), but still needs to be imported once
// somewhere in the graph (mirrors app.module.ts) for DownloadStateService's
// DbService dependency to resolve.
@Module({
  imports: [
    DbModule,
    NestMinioModule.register({
      accessKey: 'test-access-key',
      endPoint: 'test-minio-host',
      isGlobal: true,
      port: 9000,
      secretKey: 'test-secret-key',
      useSSL: false,
    }),
    DownloadModule,
  ],
})
class RootTestModule {}

describe('DownloadModule <-> MediaModule wiring', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_PATH: ':memory:',
      RADARR_API_KEY: 'test-radarr-key',
      RADARR_URL: 'http://localhost:7878',
      SONARR_API_KEY: 'test-sonarr-key',
      SONARR_URL: 'http://localhost:8989',
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('resolves the DownloadModule <-> MediaModule circular dependency', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RootTestModule],
    }).compile()

    expect(module).toBeDefined()

    await module.close()
  })

  // ReleaseService sits on the awkward side of the cycle: it's provided by
  // MediaModule, depends on MediaDownloadService (same module) and DbService
  // (global), and is injected into DownloadController across the forwardRef.
  // Resolving it from the booted graph is what proves that chain actually
  // wires up rather than only type-checking.
  it('instantiates ReleaseService with its cross-module dependencies satisfied', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RootTestModule],
    }).compile()

    const releaseService = module.get(ReleaseService, { strict: false })
    expect(releaseService).toBeInstanceOf(ReleaseService)

    // The controller is the far side of the forwardRef - if MediaModule
    // failed to export ReleaseService, this is where it would show up.
    expect(module.get(DownloadController, { strict: false })).toBeDefined()

    await module.close()
  })

  // Phase 4's ShowService is injected into DownloadController across the
  // same forwardRef. It depends only on same-module providers, so the thing
  // actually at risk is the providers/exports pair in media.module.ts - a
  // provider registered but not exported type-checks fine and fails only
  // here, at boot.
  it('instantiates ShowService and injects it across the forwardRef', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RootTestModule],
    }).compile()

    expect(module.get(ShowService, { strict: false })).toBeInstanceOf(
      ShowService,
    )
    expect(module.get(DownloadController, { strict: false })).toBeDefined()

    await module.close()
  })
})
