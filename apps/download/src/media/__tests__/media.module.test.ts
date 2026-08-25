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
import { EmbyService } from 'src/emby/emby.service'
import { EmbyStatusService } from 'src/emby/emby-status.service'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
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
      // EmbyService and EmbyStatusService both read env in their
      // constructors, so all four must be set for MediaModule's EmbyModule
      // import to boot - a missing one surfaces only as the single var that
      // happens to be read first.
      EMBY_API_KEY: 'test-emby-key',
      EMBY_EXTERNAL_URL: 'http://emby.localhost',
      EMBY_URL: 'http://localhost:8096',
      EMBY_USERNAME: 'test-emby-user',
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

  // Phase 6's EmbyStatusService is injected into MediaResolverService, which
  // MediaModule reaches through its EmbyModule import. Every other test in
  // this unit mocks MediaResolverService's collaborators by DI token, so this
  // is the only place that exercises the real EmbyModule wiring: drop
  // EmbyStatusService from EmbyModule's exports and every unit test still
  // passes while the whole graph fails to compile here (verified by doing
  // exactly that). Both services also read env in their constructors, so
  // resolving them proves the four EMBY_* vars above are what boot needs.
  it('resolves EmbyModule providers through MediaModule at boot', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RootTestModule],
    }).compile()

    expect(module.get(EmbyStatusService, { strict: false })).toBeInstanceOf(
      EmbyStatusService,
    )
    expect(module.get(EmbyService, { strict: false })).toBeInstanceOf(
      EmbyService,
    )

    // MediaResolverService is the consumer across the module boundary - if
    // EmbyModule failed to export EmbyStatusService, this is where it breaks.
    expect(module.get(MediaResolverService, { strict: false })).toBeInstanceOf(
      MediaResolverService,
    )

    await module.close()
  })

  // Phase 7's MediaFileService is the only provider in this module that takes
  // the MINIO_CONNECTION token, which comes from a globally-registered
  // NestMinioModule rather than from MediaModule's own imports. Every unit
  // test hands it a `useValue` stub, so this is the one place that proves the
  // real token resolves - and, as with ShowService above, that the provider
  // was actually exported and not just provided.
  it('instantiates MediaFileService with its MinIO connection injected', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RootTestModule],
    }).compile()

    expect(module.get(MediaFileService, { strict: false })).toBeInstanceOf(
      MediaFileService,
    )

    await module.close()
  })
})
