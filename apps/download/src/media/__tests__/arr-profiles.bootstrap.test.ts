import { DownloadType } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { createTestDb, type TestDb } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { ArrProfilesBootstrap } from 'src/media/arr-profiles.bootstrap'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

describe('ArrProfilesBootstrap', () => {
  let bootstrap: ArrProfilesBootstrap
  let radarr: {
    ensureTierProfiles: jest.Mock
    syncFlaggedReleaseProfile: jest.Mock
  }
  let sonarr: {
    ensureTierProfiles: jest.Mock
    syncFlaggedReleaseProfile: jest.Mock
  }
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let testDb: TestDb

  beforeEach(async () => {
    radarr = {
      ensureTierProfiles: jest.fn().mockResolvedValue(undefined),
      syncFlaggedReleaseProfile: jest.fn().mockResolvedValue(undefined),
    }
    sonarr = {
      ensureTierProfiles: jest.fn().mockResolvedValue(undefined),
      syncFlaggedReleaseProfile: jest.fn().mockResolvedValue(undefined),
    }
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    testDb = createTestDb()

    const module = await Test.createTestingModule({
      providers: [
        ArrProfilesBootstrap,
        { provide: DbService, useValue: { db: testDb.db } },
        { provide: RadarrService, useValue: radarr },
        { provide: SonarrService, useValue: sonarr },
      ],
    }).compile()

    bootstrap = module.get(ArrProfilesBootstrap)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    testDb.close()
  })

  it('ensures both apps', async () => {
    await bootstrap.ensureAll()

    expect(radarr.ensureTierProfiles).toHaveBeenCalledTimes(1)
    expect(sonarr.ensureTierProfiles).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('still ensures Sonarr when Radarr throws, and only logs', async () => {
    radarr.ensureTierProfiles.mockRejectedValue(new Error('radarr down'))

    await expect(bootstrap.ensureAll()).resolves.toBeUndefined()

    expect(sonarr.ensureTierProfiles).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toMatch(/Radarr.*radarr down/)
  })

  it('logs each app that fails', async () => {
    radarr.ensureTierProfiles.mockRejectedValue(new Error('radarr down'))
    sonarr.ensureTierProfiles.mockRejectedValue('sonarr down')

    await expect(bootstrap.ensureAll()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy.mock.calls[1][0]).toMatch(/Sonarr.*sonarr down/)
  })

  it('starts the run at boot without holding boot up', async () => {
    let finish: () => void = () => undefined
    radarr.ensureTierProfiles.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve
      }),
    )

    expect(bootstrap.onApplicationBootstrap()).toBeUndefined()
    expect(radarr.ensureTierProfiles).toHaveBeenCalledTimes(1)
    expect(sonarr.ensureTierProfiles).toHaveBeenCalledTimes(1)

    finish()
  })

  it('never lets a boot-time failure escape', async () => {
    radarr.ensureTierProfiles.mockRejectedValue(new Error('radarr down'))
    sonarr.ensureTierProfiles.mockRejectedValue(new Error('sonarr down'))

    bootstrap.onApplicationBootstrap()
    await new Promise(resolve => setImmediate(resolve))

    expect(errorSpy).toHaveBeenCalledTimes(2)
  })

  describe('flagged releases', () => {
    function flag(mediaId: string, releaseGuid: string, title: string): void {
      insertBadFile(testDb.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId,
        mediaType: mediaId.startsWith('tmdb:')
          ? DownloadType.Movie
          : DownloadType.Show,
        releaseGuid,
        releaseTitle: title,
      })
    }

    it('mirrors each app its own flagged titles', async () => {
      flag('tmdb:1', 'g1', 'Movie.One')
      flag('tvdb:2', 'g2', 'Show.Two')

      await bootstrap.ensureAll()

      expect(radarr.syncFlaggedReleaseProfile).toHaveBeenCalledWith([
        'Movie.One',
      ])
      expect(sonarr.syncFlaggedReleaseProfile).toHaveBeenCalledWith([
        'Show.Two',
      ])
    })

    it('still syncs with no flags, so a leftover profile is removed', async () => {
      await bootstrap.ensureAll()

      expect(radarr.syncFlaggedReleaseProfile).toHaveBeenCalledWith([])
      expect(sonarr.syncFlaggedReleaseProfile).toHaveBeenCalledWith([])
    })

    it('logs each app whose sync fails and carries on', async () => {
      radarr.syncFlaggedReleaseProfile.mockRejectedValue(
        new Error('radarr down'),
      )
      sonarr.syncFlaggedReleaseProfile.mockRejectedValue(
        new Error('sonarr down'),
      )

      await expect(bootstrap.ensureAll()).resolves.toBeUndefined()

      expect(radarr.ensureTierProfiles).toHaveBeenCalledTimes(1)
      expect(sonarr.ensureTierProfiles).toHaveBeenCalledTimes(1)
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(2)
      expect(warnSpy.mock.calls.map(([message]) => message)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Radarr.*radarr down/),
          expect.stringMatching(/Sonarr.*sonarr down/),
        ]),
      )
    })

    it('never lets a boot-time sync failure escape', async () => {
      radarr.syncFlaggedReleaseProfile.mockRejectedValue(
        new Error('radarr down'),
      )

      bootstrap.onApplicationBootstrap()
      await new Promise(resolve => setImmediate(resolve))

      expect(sonarr.syncFlaggedReleaseProfile).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })
})
