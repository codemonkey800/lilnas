import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

// - Both SDKs mocked before anything imports them: no test here may reach
//   a real Radarr or Sonarr
jest.mock('@lilnas/media/radarr', () => ({
  deleteApiV3ReleaseprofileById: jest.fn(),
  getApiV3Releaseprofile: jest.fn(),
  postApiV3Releaseprofile: jest.fn(),
  putApiV3ReleaseprofileById: jest.fn(),
}))
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3ReleaseprofileById: jest.fn(),
  getApiV3Releaseprofile: jest.fn(),
  postApiV3Releaseprofile: jest.fn(),
  putApiV3ReleaseprofileById: jest.fn(),
}))

import * as radarrSdk from '@lilnas/media/radarr'
import * as sonarrSdk from '@lilnas/media/sonarr'

import { RADARR_CLIENT, SONARR_CLIENT } from 'src/media/clients'
import {
  FLAGGED_RELEASE_PROFILE_NAME,
  type ReleaseProfileLike,
} from 'src/media/flagged-release-terms.util'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

interface FlaggedProfileOwner {
  syncFlaggedReleaseProfile(titles: string[]): Promise<void>
}

interface SdkMocks {
  list: jest.Mock
  create: jest.Mock
  update: jest.Mock
  remove: jest.Mock
}

function mocksOf(sdk: typeof radarrSdk | typeof sonarrSdk): SdkMocks {
  return {
    list: sdk.getApiV3Releaseprofile as jest.Mock,
    create: sdk.postApiV3Releaseprofile as jest.Mock,
    update: sdk.putApiV3ReleaseprofileById as jest.Mock,
    remove: sdk.deleteApiV3ReleaseprofileById as jest.Mock,
  }
}

const APPS: {
  app: string
  build: () => Promise<FlaggedProfileOwner>
  mocks: SdkMocks
}[] = [
  {
    app: 'radarr',
    build: async () => {
      const module = await Test.createTestingModule({
        providers: [RadarrService, { provide: RADARR_CLIENT, useValue: {} }],
      }).compile()
      return module.get(RadarrService)
    },
    mocks: mocksOf(radarrSdk),
  },
  {
    app: 'sonarr',
    build: async () => {
      const module = await Test.createTestingModule({
        providers: [SonarrService, { provide: SONARR_CLIENT, useValue: {} }],
      }).compile()
      return module.get(SonarrService)
    },
    mocks: mocksOf(sonarrSdk),
  },
]

function ok<T>(data: T) {
  return { data, response: { status: 200 } }
}

function managed(id: number, ignored: string[]): ReleaseProfileLike {
  return {
    enabled: true,
    id,
    ignored,
    indexerId: 0,
    name: FLAGGED_RELEASE_PROFILE_NAME,
    required: [],
    tags: [],
  }
}

const OTHER_PROFILE: ReleaseProfileLike = {
  enabled: true,
  id: 1,
  ignored: ['CAM'],
  indexerId: 0,
  name: 'Hand-made',
  required: [],
  tags: [],
}

describe.each(APPS)('$app syncFlaggedReleaseProfile', ({ build, mocks }) => {
  let service: FlaggedProfileOwner
  let warnSpy: jest.SpyInstance

  beforeEach(async () => {
    jest.resetAllMocks()
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()

    service = await build()

    mocks.list.mockResolvedValue(ok([OTHER_PROFILE]))
    mocks.create.mockImplementation(
      async ({ body }: { body: ReleaseProfileLike }) =>
        ok({ ...body, id: 100 }),
    )
    mocks.update.mockImplementation(
      async ({ body }: { body: ReleaseProfileLike }) => ok(body),
    )
    mocks.remove.mockResolvedValue({ data: {}, response: { status: 200 } })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('creates the profile, enabled, for every indexer and title, with the terms as an array', async () => {
    await service.syncFlaggedReleaseProfile([
      'Movie.2020.1080p',
      'Hello, World.2021',
    ])

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].body).toEqual({
      enabled: true,
      ignored: ['Hello, World.2021', 'Movie.2020.1080p'],
      indexerId: 0,
      name: FLAGGED_RELEASE_PROFILE_NAME,
      required: [],
      tags: [],
    })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('leaves the profile alone when the term set has not changed', async () => {
    mocks.list.mockResolvedValue(ok([OTHER_PROFILE, managed(7, ['b', 'a'])]))

    await service.syncFlaggedReleaseProfile(['a', 'B', 'b'])

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('updates the profile in place when the term set changed', async () => {
    mocks.list.mockResolvedValue(ok([OTHER_PROFILE, managed(7, ['a'])]))

    await service.syncFlaggedReleaseProfile(['a', 'b'])

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      body: { enabled: true, id: 7, ignored: ['a', 'b'] },
      path: { id: '7' },
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('deletes the profile once no flagged titles remain', async () => {
    mocks.list.mockResolvedValue(ok([OTHER_PROFILE, managed(7, ['a'])]))

    await service.syncFlaggedReleaseProfile([])

    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(mocks.remove.mock.calls[0][0]).toMatchObject({ path: { id: 7 } })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does nothing with no flagged titles and no profile', async () => {
    await service.syncFlaggedReleaseProfile([])

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('never touches a profile under another name', async () => {
    await service.syncFlaggedReleaseProfile(['a'])
    await service.syncFlaggedReleaseProfile([])

    const touched = [
      ...mocks.update.mock.calls.map(([opts]) => opts.path.id),
      ...mocks.remove.mock.calls.map(([opts]) => opts.path.id),
    ]
    expect(touched).not.toContain(OTHER_PROFILE.id)
    expect(touched).not.toContain(String(OTHER_PROFILE.id))
  })

  it('skips a title with a slash and warns about it once', async () => {
    await service.syncFlaggedReleaseProfile(['AC/DC.Live', 'Fine.Title'])
    await service.syncFlaggedReleaseProfile(['AC/DC.Live', 'Fine.Title'])

    expect(mocks.create.mock.calls[0][0].body.ignored).toEqual(['Fine.Title'])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/AC\/DC\.Live/)
  })

  it('rejects when the app does', async () => {
    mocks.list.mockResolvedValue({
      error: { message: 'boom' },
      response: { status: 500 },
    })

    await expect(service.syncFlaggedReleaseProfile(['a'])).rejects.toThrow(
      /getReleaseProfiles failed/,
    )
  })
})
