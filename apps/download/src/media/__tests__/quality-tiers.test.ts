import { QUALITY_TIERS, QualityTier } from '@lilnas/utils/download/types'

import {
  type ArrApp,
  NEVER_ALLOWED_QUALITY_IDS,
  planTierProfiles,
  profileDrifted,
  TIER_PROFILE_PREFIX,
  TIER_QUALITY_IDS,
  tierProfileName,
  tierProfileSpec,
  type TierQualityProfile,
} from 'src/media/quality-tiers'

import {
  allowedTopLevelIds,
  allQualityIds,
  radarrSchema,
  sonarrSchema,
} from './fixtures/quality-profile-schema.fixtures'

const SCHEMAS: Record<ArrApp, () => TierQualityProfile> = {
  radarr: radarrSchema,
  sonarr: sonarrSchema,
}

const CASES = (['radarr', 'sonarr'] as const).flatMap(app =>
  QUALITY_TIERS.map(tier => ({ app, tier })),
)

describe('tierProfileName', () => {
  it('prefixes each tier label', () => {
    expect(tierProfileName(QualityTier.UpTo4k)).toBe('lilnas · Up to 4K')
    expect(tierProfileName(QualityTier.Hd)).toBe('lilnas · HD (up to 1080p)')
    expect(tierProfileName(QualityTier.UpTo720p)).toBe('lilnas · Up to 720p')
    for (const tier of QUALITY_TIERS) {
      expect(tierProfileName(tier).startsWith(TIER_PROFILE_PREFIX)).toBe(true)
    }
  })
})

describe('TIER_QUALITY_IDS', () => {
  it.each(CASES)(
    '$app $tier lists no never-allowed quality',
    ({ app, tier }) => {
      const never = new Set(NEVER_ALLOWED_QUALITY_IDS[app])
      expect(TIER_QUALITY_IDS[app][tier].filter(id => never.has(id))).toEqual(
        [],
      )
    },
  )

  it.each(CASES)('$app $tier lists each id once', ({ app, tier }) => {
    const ids = TIER_QUALITY_IDS[app][tier]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(['radarr', 'sonarr'] as const)(
    '%s tiers nest: 720p within HD within 4K',
    app => {
      const tiers = TIER_QUALITY_IDS[app]
      expect(tiers[QualityTier.UpTo4k]).toEqual(
        expect.arrayContaining([...tiers[QualityTier.Hd]]),
      )
      expect(tiers[QualityTier.Hd]).toEqual(
        expect.arrayContaining([...tiers[QualityTier.UpTo720p]]),
      )
      // - The 720p tier is HD's tail from Bluray-720p, so it keeps HD's order
      expect(
        tiers[QualityTier.Hd].slice(-tiers[QualityTier.UpTo720p].length),
      ).toEqual(tiers[QualityTier.UpTo720p])
    },
  )
})

describe('tierProfileSpec', () => {
  describe.each(CASES)('$app $tier', ({ app, tier }) => {
    const schema = SCHEMAS[app]()
    const spec = tierProfileSpec(app, tier, schema)

    it('keeps every schema quality exactly once', () => {
      expect(allQualityIds(spec)).toEqual(allQualityIds(schema))
      expect(spec.items).toHaveLength(schema.items?.length ?? 0)
    })

    it('allows exactly the tier, best item last', () => {
      expect(allowedTopLevelIds(spec)).toEqual(
        [...TIER_QUALITY_IDS[app][tier]].reverse(),
      )
    })

    it('puts every disallowed item before the allowed ones', () => {
      const allowed = (spec.items ?? []).map(item => item.allowed === true)
      const firstAllowed = allowed.indexOf(true)
      expect(allowed.slice(firstAllowed).every(Boolean)).toBe(true)
    })

    it('never allows an excluded quality', () => {
      const never = new Set(NEVER_ALLOWED_QUALITY_IDS[app])
      const allowedQualities = (spec.items ?? [])
        .filter(item => item.allowed)
        .flatMap(item =>
          item.items?.length
            ? item.items.map(m => m.quality?.id)
            : [item.quality?.id],
        )
      expect(
        allowedQualities.filter(id => id != null && never.has(id)),
      ).toEqual([])
    })

    it('sets the cutoff to the top allowed item', () => {
      const allowed = allowedTopLevelIds(spec)
      expect(spec.cutoff).toBe(TIER_QUALITY_IDS[app][tier][0])
      expect(spec.cutoff).toBe(allowed[allowed.length - 1])
    })

    it('keeps groups whole, members matching the group', () => {
      const groups = (spec.items ?? []).filter(item => item.items?.length)
      expect(groups.map(g => g.id).sort()).toEqual([1000, 1001, 1002, 1003])
      for (const g of groups) {
        expect(g.name).toMatch(/^WEB \d+p$/)
        expect(g.items).toHaveLength(2)
        for (const member of g.items ?? []) {
          expect(member.allowed).toBe(g.allowed)
        }
      }
    })

    it('names it, turns upgrades off and zeroes the scores', () => {
      expect(spec).toMatchObject({
        name: tierProfileName(tier),
        upgradeAllowed: false,
        minFormatScore: 0,
        cutoffFormatScore: 0,
        minUpgradeFormatScore: 1,
        formatItems: [],
      })
      expect(spec.id).toBeUndefined()
    })

    it('leaves the schema untouched', () => {
      expect(schema).toEqual(SCHEMAS[app]())
    })
  })

  it('gives Radarr profiles English, not the schema default', () => {
    const spec = tierProfileSpec('radarr', QualityTier.Hd, radarrSchema())
    expect(spec.language).toEqual({ id: 1, name: 'English' })
  })

  it('takes a Radarr language override', () => {
    const spec = tierProfileSpec('radarr', QualityTier.Hd, radarrSchema(), {
      language: { id: 8, name: 'Japanese' },
    })
    expect(spec.language).toEqual({ id: 8, name: 'Japanese' })
  })

  it('gives Sonarr profiles no language', () => {
    const spec = tierProfileSpec('sonarr', QualityTier.Hd, sonarrSchema())
    expect(spec).not.toHaveProperty('language')
  })

  it('keeps custom formats, scored 0', () => {
    const schema = {
      ...radarrSchema(),
      formatItems: [{ format: 3, name: 'x265', score: 50 }],
    }
    expect(
      tierProfileSpec('radarr', QualityTier.Hd, schema).formatItems,
    ).toEqual([{ format: 3, name: 'x265', score: 0 }])
  })

  it('stops HD at 1080p and 720p at 720p', () => {
    const hd = allowedTopLevelIds(
      tierProfileSpec('radarr', QualityTier.Hd, radarrSchema()),
    )
    for (const id of [31, 19, 1003, 16]) expect(hd).not.toContain(id)
    expect(hd[hd.length - 1]).toBe(30)

    const sd = allowedTopLevelIds(
      tierProfileSpec('sonarr', QualityTier.UpTo720p, sonarrSchema()),
    )
    for (const id of [20, 7, 1002, 9]) expect(sd).not.toContain(id)
    expect(sd[sd.length - 1]).toBe(6)
  })

  it('throws, naming the id, when the schema lacks a listed quality', () => {
    const schema = radarrSchema()
    schema.items = schema.items?.filter(item => item.quality?.id !== 7)

    expect(() => tierProfileSpec('radarr', QualityTier.Hd, schema)).toThrow(
      /radarr .*id 7 - the hd tier table/,
    )
    // - A tier that doesn't list it still builds
    expect(() =>
      tierProfileSpec('radarr', QualityTier.UpTo720p, schema),
    ).not.toThrow()
  })

  it('throws when a group went missing', () => {
    const schema = sonarrSchema()
    schema.items = schema.items?.filter(item => item.id !== 1003)

    expect(() => tierProfileSpec('sonarr', QualityTier.UpTo4k, schema)).toThrow(
      /1003/,
    )
  })
})

describe('profileDrifted', () => {
  const wanted = tierProfileSpec('radarr', QualityTier.Hd, radarrSchema())

  it('is false for the profile itself', () => {
    expect(profileDrifted(wanted, wanted)).toBe(false)
  })

  it('ignores the name, id, scores, language and disallowed order', () => {
    const items = wanted.items ?? []
    const disallowedCount = items.filter(item => !item.allowed).length
    const existing: TierQualityProfile = {
      ...wanted,
      id: 42,
      name: 'renamed',
      minFormatScore: 10,
      cutoffFormatScore: 20,
      formatItems: [{ score: 5 }],
      language: { id: -2, name: 'Original' },
      items: [
        ...items.slice(0, disallowedCount).reverse(),
        ...items.slice(disallowedCount),
      ],
    }
    expect(profileDrifted(existing, wanted)).toBe(false)
  })

  it('catches a different cutoff', () => {
    expect(profileDrifted({ ...wanted, cutoff: 6 }, wanted)).toBe(true)
  })

  it('catches upgrades turned on', () => {
    expect(profileDrifted({ ...wanted, upgradeAllowed: true }, wanted)).toBe(
      true,
    )
  })

  it('catches an extra allowed quality', () => {
    const items = (wanted.items ?? []).map(item =>
      item.quality?.id === 25 ? { ...item, allowed: true } : item,
    )
    expect(profileDrifted({ ...wanted, items }, wanted)).toBe(true)
  })

  it('catches a quality no longer allowed', () => {
    const items = (wanted.items ?? []).map(item =>
      item.quality?.id === 9 ? { ...item, allowed: false } : item,
    )
    expect(profileDrifted({ ...wanted, items }, wanted)).toBe(true)
  })

  it('catches the allowed items reordered', () => {
    const all = wanted.items ?? []
    const items = [...all.slice(0, -2), ...all.slice(-2).reverse()]
    expect(profileDrifted({ ...wanted, items }, wanted)).toBe(true)
  })

  it('catches a group member switched off', () => {
    const items = (wanted.items ?? []).map(item =>
      item.id === 1002
        ? {
            ...item,
            items: (item.items ?? []).map((m, i) =>
              i === 0 ? { ...m, allowed: false } : m,
            ),
          }
        : item,
    )
    expect(profileDrifted({ ...wanted, items }, wanted)).toBe(true)
  })
})

describe('planTierProfiles', () => {
  const schema = radarrSchema()
  const specs = Object.fromEntries(
    QUALITY_TIERS.map(tier => [tier, tierProfileSpec('radarr', tier, schema)]),
  ) as Record<QualityTier, TierQualityProfile>

  it('creates every tier when none exist', () => {
    const plans = planTierProfiles('radarr', [], schema)
    expect(plans).toEqual(
      QUALITY_TIERS.map(tier => ({
        action: 'create',
        tier,
        profile: specs[tier],
      })),
    )
  })

  it('keeps tiers that match, creates the one that was deleted', () => {
    const existing = [
      { ...specs[QualityTier.UpTo4k], id: 10 },
      { ...specs[QualityTier.UpTo720p], id: 12 },
    ]
    expect(
      planTierProfiles('radarr', existing, schema).map(p => p.action),
    ).toEqual(['keep', 'create', 'keep'])
  })

  it('updates a drifted tier, keeping its id and other fields', () => {
    const drifted = {
      ...specs[QualityTier.Hd],
      id: 11,
      cutoff: 6,
      minFormatScore: 7,
      language: { id: -2, name: 'Original' },
    }
    const plan = planTierProfiles('radarr', [drifted], schema).find(
      p => p.tier === QualityTier.Hd,
    )

    expect(plan).toEqual({
      action: 'update',
      tier: QualityTier.Hd,
      id: 11,
      profile: {
        ...drifted,
        cutoff: specs[QualityTier.Hd].cutoff,
        items: specs[QualityTier.Hd].items,
        upgradeAllowed: false,
      },
    })
  })

  it('never matches a profile without the prefix', () => {
    const existing = [
      { ...specs[QualityTier.Hd], id: 1, name: 'Any' },
      { ...specs[QualityTier.Hd], id: 2, name: 'HD - 720p/1080p' },
      { ...specs[QualityTier.Hd], id: 3, name: 'HD (up to 1080p)' },
      { ...specs[QualityTier.UpTo4k], id: 4, name: 'Up to 4K' },
    ]
    expect(
      planTierProfiles('radarr', existing, schema).map(p => p.action),
    ).toEqual(['create', 'create', 'create'])
  })

  it('throws as tierProfileSpec does', () => {
    const broken = { ...schema, items: [] }
    expect(() => planTierProfiles('radarr', [], broken)).toThrow(/radarr/)
  })
})
