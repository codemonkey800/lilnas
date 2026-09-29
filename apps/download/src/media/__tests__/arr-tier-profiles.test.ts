import { QUALITY_TIERS, QualityTier } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

// - Both SDKs mocked before anything imports them: no test here may reach
//   a real Radarr or Sonarr
jest.mock('@lilnas/media/radarr', () => ({
  getApiV3Qualityprofile: jest.fn(),
  getApiV3QualityprofileSchema: jest.fn(),
  postApiV3Qualityprofile: jest.fn(),
  putApiV3QualityprofileById: jest.fn(),
}))
jest.mock('@lilnas/media/sonarr', () => ({
  getApiV3Qualityprofile: jest.fn(),
  getApiV3QualityprofileSchema: jest.fn(),
  postApiV3Qualityprofile: jest.fn(),
  putApiV3QualityprofileById: jest.fn(),
}))

import * as radarrSdk from '@lilnas/media/radarr'
import * as sonarrSdk from '@lilnas/media/sonarr'

import { RADARR_CLIENT, SONARR_CLIENT } from 'src/media/clients'
import {
  type ArrApp,
  tierProfileName,
  tierProfileSpec,
  type TierQualityProfile,
} from 'src/media/quality-tiers'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

import {
  radarrSchema,
  sonarrSchema,
} from './fixtures/quality-profile-schema.fixtures'

/** The tier-profile surface both services share. */
interface TierProfileOwner {
  ensureTierProfiles(): Promise<void>
  tierProfileId(tier: QualityTier): Promise<number>
  tierForProfileId(id: number): QualityTier | null
}

interface SdkMocks {
  list: jest.Mock
  schema: jest.Mock
  create: jest.Mock
  update: jest.Mock
}

function mocksOf(sdk: typeof radarrSdk | typeof sonarrSdk): SdkMocks {
  return {
    list: sdk.getApiV3Qualityprofile as jest.Mock,
    schema: sdk.getApiV3QualityprofileSchema as jest.Mock,
    create: sdk.postApiV3Qualityprofile as jest.Mock,
    update: sdk.putApiV3QualityprofileById as jest.Mock,
  }
}

const APPS: {
  app: ArrApp
  build: () => Promise<TierProfileOwner>
  mocks: SdkMocks
  schema: () => TierQualityProfile
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
    schema: radarrSchema,
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
    schema: sonarrSchema,
  },
]

function ok<T>(data: T) {
  return { data, response: { status: 200 } }
}

describe.each(APPS)('$app tier profiles', ({ app, build, mocks, schema }) => {
  let service: TierProfileOwner

  /** What a fresh create of each tier would look like, with an id. */
  function stored(tier: QualityTier, id: number): TierQualityProfile {
    return { ...tierProfileSpec(app, tier, schema()), id }
  }

  beforeEach(async () => {
    jest.resetAllMocks()
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()

    service = await build()

    mocks.schema.mockResolvedValue(ok(schema()))
    mocks.list.mockResolvedValue(ok([]))
    let nextId = 100
    mocks.create.mockImplementation(
      async ({ body }: { body: TierQualityProfile }) =>
        ok({ ...body, id: nextId++ }),
    )
    mocks.update.mockImplementation(
      async ({ body }: { body: TierQualityProfile }) => ok(body),
    )
  })

  describe('ensureTierProfiles', () => {
    it('creates all three when none exist, best tier first', async () => {
      await service.ensureTierProfiles()

      expect(mocks.create).toHaveBeenCalledTimes(3)
      expect(mocks.create.mock.calls.map(([opts]) => opts.body.name)).toEqual(
        QUALITY_TIERS.map(tierProfileName),
      )
      expect(mocks.create.mock.calls[1][0].body).toEqual(
        tierProfileSpec(app, QualityTier.Hd, schema()),
      )
      expect(mocks.update).not.toHaveBeenCalled()

      await expect(service.tierProfileId(QualityTier.UpTo4k)).resolves.toBe(100)
      await expect(service.tierProfileId(QualityTier.Hd)).resolves.toBe(101)
      await expect(service.tierProfileId(QualityTier.UpTo720p)).resolves.toBe(
        102,
      )
    })

    it('does nothing when every tier is already in shape', async () => {
      mocks.list.mockResolvedValue(
        ok([
          stored(QualityTier.UpTo4k, 7),
          stored(QualityTier.Hd, 8),
          stored(QualityTier.UpTo720p, 9),
        ]),
      )

      await service.ensureTierProfiles()

      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(service.tierForProfileId(8)).toBe(QualityTier.Hd)
    })

    it('recreates a deleted tier', async () => {
      mocks.list.mockResolvedValue(
        ok([stored(QualityTier.UpTo4k, 7), stored(QualityTier.UpTo720p, 9)]),
      )

      await service.ensureTierProfiles()

      expect(mocks.create).toHaveBeenCalledTimes(1)
      expect(mocks.create.mock.calls[0][0].body.name).toBe(
        tierProfileName(QualityTier.Hd),
      )
      await expect(service.tierProfileId(QualityTier.Hd)).resolves.toBe(100)
    })

    it('PUTs a drifted tier back, keeping its id and other fields', async () => {
      const drifted = {
        ...stored(QualityTier.Hd, 8),
        cutoff: 1,
        upgradeAllowed: true,
        minFormatScore: 25,
        formatItems: [{ format: 4, name: 'x265', score: 25 }],
      }
      mocks.list.mockResolvedValue(
        ok([
          stored(QualityTier.UpTo4k, 7),
          drifted,
          stored(QualityTier.UpTo720p, 9),
        ]),
      )

      await service.ensureTierProfiles()

      const wanted = tierProfileSpec(app, QualityTier.Hd, schema())
      expect(mocks.update).toHaveBeenCalledTimes(1)
      expect(mocks.update).toHaveBeenCalledWith({
        client: {},
        path: { id: '8' },
        body: {
          ...drifted,
          cutoff: wanted.cutoff,
          upgradeAllowed: false,
          items: wanted.items,
        },
      })
      expect(mocks.create).not.toHaveBeenCalled()
      await expect(service.tierProfileId(QualityTier.Hd)).resolves.toBe(8)
    })

    it('never touches a profile without the prefix', async () => {
      mocks.list.mockResolvedValue(
        ok([
          { ...stored(QualityTier.Hd, 1), name: 'Any', cutoff: 0 },
          { ...stored(QualityTier.Hd, 2), name: 'HD - 720p/1080p', cutoff: 0 },
          { ...stored(QualityTier.UpTo4k, 3), name: 'Up to 4K' },
        ]),
      )

      await service.ensureTierProfiles()

      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.create).toHaveBeenCalledTimes(3)
      expect(service.tierForProfileId(1)).toBeNull()
      expect(service.tierForProfileId(3)).toBeNull()
    })

    it('shares one run between concurrent calls', async () => {
      await Promise.all([
        service.ensureTierProfiles(),
        service.ensureTierProfiles(),
        service.tierProfileId(QualityTier.Hd),
      ])

      expect(mocks.list).toHaveBeenCalledTimes(1)
      expect(mocks.create).toHaveBeenCalledTimes(3)
    })

    it('fails loudly, creating nothing, when the schema lacks a tier id', async () => {
      const broken = schema()
      broken.items = broken.items?.filter(item => item.quality?.id !== 6)
      mocks.schema.mockResolvedValue(ok(broken))

      await expect(service.ensureTierProfiles()).rejects.toThrow(/id 6/)
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('keeps the tiers that landed before a failure', async () => {
      mocks.create
        .mockResolvedValueOnce(ok({ id: 100 }))
        .mockResolvedValueOnce({
          error: { message: 'boom' },
          response: { status: 500 },
        })

      await expect(service.ensureTierProfiles()).rejects.toThrow(/boom/)
      expect(service.tierForProfileId(100)).toBe(QualityTier.UpTo4k)
    })
  })

  describe('tierProfileId', () => {
    it('ensures the profiles lazily on a miss, then serves the cache', async () => {
      mocks.list.mockResolvedValue(
        ok([
          stored(QualityTier.UpTo4k, 7),
          stored(QualityTier.Hd, 8),
          stored(QualityTier.UpTo720p, 9),
        ]),
      )

      await expect(service.tierProfileId(QualityTier.UpTo720p)).resolves.toBe(9)
      await expect(service.tierProfileId(QualityTier.Hd)).resolves.toBe(8)

      expect(mocks.list).toHaveBeenCalledTimes(1)
      expect(mocks.schema).toHaveBeenCalledTimes(1)
    })

    it('rejects when the lazy run fails, and retries on the next call', async () => {
      mocks.list.mockResolvedValueOnce({
        error: { message: 'unreachable' },
        response: undefined,
      })

      await expect(service.tierProfileId(QualityTier.Hd)).rejects.toThrow(
        /unreachable/,
      )
      await expect(service.tierProfileId(QualityTier.Hd)).resolves.toBe(101)
      expect(mocks.list).toHaveBeenCalledTimes(2)
    })

    it('rejects when a create comes back without an id', async () => {
      mocks.create.mockResolvedValue(ok({ name: 'no id' }))

      await expect(service.tierProfileId(QualityTier.Hd)).rejects.toThrow(
        /without an id/,
      )
    })
  })

  describe('tierForProfileId', () => {
    it('is null before the cache is filled', () => {
      expect(service.tierForProfileId(100)).toBeNull()
    })

    it('maps our ids back to tiers and anything else to null', async () => {
      await service.ensureTierProfiles()

      expect(service.tierForProfileId(100)).toBe(QualityTier.UpTo4k)
      expect(service.tierForProfileId(101)).toBe(QualityTier.Hd)
      expect(service.tierForProfileId(102)).toBe(QualityTier.UpTo720p)
      expect(service.tierForProfileId(1)).toBeNull()
    })
  })
})
