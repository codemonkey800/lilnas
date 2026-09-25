import type { MediaState, Season } from '@lilnas/utils/download/types'
import {
  DownloadType,
  MEDIA_STATE_PRECEDENCE,
} from '@lilnas/utils/download/types'

import {
  episode,
  scopedJob,
  season,
  show,
  specials,
} from 'src/components/detail/__tests__/fixtures/show'
import {
  defaultSeasonNumber,
  deleteCascade,
  episodeCode,
  episodeKey,
  episodeMediaState,
  episodeProgressLabel,
  episodeScopedJobs,
  episodeState,
  isDownloadableState,
  isMetadataMissing,
  seasonByTabValue,
  seasonEpisodeTotal,
  seasonHeading,
  seasonLabel,
  seasonProgress,
  seasonScopedJobs,
  seasonState,
  seasonTabValue,
  seriesProgress,
  seriesState,
  showMetaLine,
  SPECIALS_SEASON_NUMBER,
} from 'src/components/detail/show-state'

describe('season labelling', () => {
  it('⚠️ names season 0 "Specials" rather than filtering it out', () => {
    expect(seasonLabel(SPECIALS_SEASON_NUMBER)).toBe('Specials')
    expect(seasonLabel(0)).toBe('Specials')
  })

  it('names every other season by its number', () => {
    expect(seasonLabel(1)).toBe('Season 1')
    expect(seasonLabel(12)).toBe('Season 12')
  })

  it('gives season 0 a real tab value, so nothing can test it for truthiness', () => {
    expect(seasonTabValue(0)).toBe('0')
    expect(seasonTabValue(3)).toBe('3')
  })

  it('resolves a tab value back to its season, including specials', () => {
    const seasons = [specials(), season({ seasonNumber: 1 })]

    expect(seasonByTabValue(seasons, '0')?.seasonNumber).toBe(0)
    expect(seasonByTabValue(seasons, '1')?.seasonNumber).toBe(1)
    expect(seasonByTabValue(seasons, '9')).toBeNull()
  })
})

describe('episodeCode / episodeKey', () => {
  it('pads the display code to S02E05', () => {
    expect(episodeCode(2, 5)).toBe('S02E05')
    expect(episodeCode(0, 1)).toBe('S00E01')
    expect(episodeCode(12, 10)).toBe('S12E10')
  })

  it('⚠️ returns Sonarr’s primary key, never the episode number', () => {
    const ep = episode({ episodeNumber: 5, id: 4823 })

    expect(episodeKey(ep)).toBe(4823)
    expect(episodeKey(ep)).not.toBe(ep.episodeNumber)
  })
})

describe('seasonEpisodeTotal', () => {
  it("takes Sonarr's statistic when it is ahead of the listed episodes", () => {
    // A season still airing: Sonarr knows about ten, has listed three.
    expect(
      seasonEpisodeTotal(
        season({
          episodeCount: 10,
          episodes: [episode(), episode(), episode()],
        }),
      ),
    ).toBe(10)
  })

  it('⚠️ takes the listed episodes when the statistic excludes them (season 0)', () => {
    // Real payload: `episodeCount: 0` over five listed specials. A heading
    // reading "Specials · 0 episodes" over five rows would simply be wrong.
    expect(seasonEpisodeTotal(specials())).toBe(2)
  })
})

describe('season-level progress aggregates across episodes', () => {
  it('reports how much of the season is on disk, as a percentage', () => {
    const progress = seasonProgress(
      season({ episodeCount: 10, episodeFileCount: 6 }),
    )

    expect(progress).toEqual({ files: 6, pct: 60, total: 10 })
  })

  it('reads as "6 of 10 episodes", which is what the mockup’s legend prints', () => {
    expect(
      episodeProgressLabel(
        seasonProgress(season({ episodeCount: 10, episodeFileCount: 6 })),
      ),
    ).toBe('6 of 10 episodes')
  })

  it('singularises a one-episode season', () => {
    expect(
      episodeProgressLabel(
        seasonProgress(season({ episodeCount: 1, episodeFileCount: 1 })),
      ),
    ).toBe('1 of 1 episode')
  })

  it('draws 0% rather than dividing by zero for a season with nothing in it', () => {
    expect(seasonProgress(season({ episodeCount: 0, episodes: [] }))).toEqual({
      files: 0,
      pct: 0,
      total: 0,
    })
  })

  it('clamps a file count that has run ahead of the episode count', () => {
    expect(
      seasonProgress(season({ episodeCount: 2, episodeFileCount: 5 })),
    ).toEqual({ files: 2, pct: 100, total: 2 })
  })

  it('heads the list with the same total the rows under it add up to', () => {
    expect(seasonHeading(season({ episodeCount: 10, seasonNumber: 2 }))).toBe(
      'Season 2 · 10 episodes',
    )
    expect(seasonHeading(specials())).toBe('Specials · 2 episodes')
  })
})

describe('seriesProgress', () => {
  it('sums files and totals across every season', () => {
    expect(
      seriesProgress([
        season({ episodeCount: 8, episodeFileCount: 8, seasonNumber: 1 }),
        season({ episodeCount: 10, episodeFileCount: 6, seasonNumber: 2 }),
        season({ episodeCount: 6, episodeFileCount: 0, seasonNumber: 3 }),
      ]),
    ).toEqual({ files: 14, pct: (14 / 24) * 100, total: 24 })
  })

  it('⚠️ excludes specials, exactly as Sonarr excludes them from its own series statistics', () => {
    const seasons = [
      specials({ episodeCount: 0, episodeFileCount: 0 }),
      season({ episodeCount: 8, episodeFileCount: 8, seasonNumber: 1 }),
    ]

    // Counting the two specials would leave a fully-downloaded series reading
    // "8 of 10" forever.
    expect(seriesProgress(seasons)).toEqual({ files: 8, pct: 100, total: 8 })
  })
})

describe('⚠️ scope lives on the JOB, never in the media id', () => {
  const two = season({
    episodes: [
      episode({ episodeNumber: 1, id: 2430, seasonNumber: 2 }),
      episode({ episodeNumber: 2, id: 2431, seasonNumber: 2 }),
    ],
    seasonNumber: 2,
  })

  const seriesJob = scopedJob(undefined, { id: 'job_series' })
  const emptyScopeJob = scopedJob({}, { id: 'job_empty' })
  const seasonJob = scopedJob({ seasonNumber: 2 }, { id: 'job_season' })
  const episodeJob = scopedJob(
    { episodeId: 2431, episodeNumber: 2, seasonNumber: 2 },
    { id: 'job_episode' },
  )
  const bareEpisodeJob = scopedJob({ episodeId: 2430 }, { id: 'job_bare' })
  const otherSeasonJob = scopedJob({ seasonNumber: 5 }, { id: 'job_other' })

  const ALL = [
    seriesJob,
    emptyScopeJob,
    seasonJob,
    episodeJob,
    bareEpisodeJob,
    otherSeasonJob,
  ]

  it('keys every job off the SAME media id whatever its scope', () => {
    // The whole point: `media.id` is `tvdb:277165` on all six, which is why the
    // gallery groups a show into one card instead of one per episode.
    expect(new Set(ALL.map(entry => entry.media.id))).toEqual(
      new Set(['tvdb:277165']),
    )
  })

  it('⚠️ leaves an absent AND an empty scope (the whole series) out of a season', () => {
    const ids = seasonScopedJobs(ALL, two).map(entry => entry.id)

    expect(ids).not.toContain('job_series')
    expect(ids).not.toContain('job_empty')
  })

  it('matches a season job by its seasonNumber', () => {
    expect(seasonScopedJobs(ALL, two).map(entry => entry.id)).toContain(
      'job_season',
    )
  })

  it("matches an episode job whose scope carries only Sonarr's episode id", () => {
    // `POST /download/shows` accepts `{ episodeId }` alone, so the season has to
    // be recoverable from the id against its own episode list.
    expect(seasonScopedJobs(ALL, two).map(entry => entry.id)).toContain(
      'job_bare',
    )
  })

  it('⚠️ does NOT fold a whole-series job into a season, so one download is not seven blinking dots', () => {
    expect(seasonScopedJobs(ALL, two).map(entry => entry.id)).not.toContain(
      'job_series',
    )
  })

  it('leaves another season’s job out', () => {
    expect(seasonScopedJobs(ALL, two).map(entry => entry.id)).not.toContain(
      'job_other',
    )
  })

  it('⚠️ matches an episode on scope.episodeId against Episode.id, not episodeNumber', () => {
    const target = episode({ episodeNumber: 2, id: 2431, seasonNumber: 2 })

    expect(episodeScopedJobs(ALL, target).map(entry => entry.id)).toEqual([
      'job_episode',
    ])

    // `episodeNumber: 2` would have matched `job_bare` too if the match were on
    // the display value; it is not.
    expect(episodeScopedJobs(ALL, target).map(entry => entry.id)).not.toContain(
      'job_bare',
    )
  })
})

/**
 * Every adjacent pair in the precedence, highest first - six of them. Each is
 * the one comparison a rollup could get wrong without any other test noticing.
 */
const ADJACENT_PAIRS: readonly (readonly [MediaState, MediaState])[] = [
  ['needs_attention', 'downloading'],
  ['downloading', 'importing'],
  ['importing', 'paused'],
  ['paused', 'available'],
  ['available', 'wanted'],
  ['wanted', 'absent'],
]

describe('episodeMediaState', () => {
  it('reads the state the seasons route served', () => {
    expect(episodeMediaState(episode({ state: 'importing' }))).toBe('importing')
  })

  it('reads a payload that carries no state as absent', () => {
    expect(
      episodeMediaState(episode({ hasFile: true, state: undefined })),
    ).toBe('absent')
  })
})

describe('seasonState rolls up its episodes', () => {
  it('covers every adjacent pair in the precedence', () => {
    expect(ADJACENT_PAIRS.map(([higher]) => higher)).toEqual(
      MEDIA_STATE_PRECEDENCE.slice(0, -1),
    )
    expect(ADJACENT_PAIRS.map(([, lower]) => lower)).toEqual(
      MEDIA_STATE_PRECEDENCE.slice(1),
    )
  })

  it.each(ADJACENT_PAIRS)('%s outranks %s', (higher, lower) => {
    const inOrder = season({
      episodes: [
        episode({ id: 101, state: lower }),
        episode({ id: 102, state: higher }),
      ],
    })
    const reversed = season({
      episodes: [
        episode({ id: 101, state: higher }),
        episode({ id: 102, state: lower }),
      ],
    })

    expect(seasonState(inOrder)).toBe(higher)
    expect(seasonState(reversed)).toBe(higher)
  })

  it('is absent for a season Sonarr has listed no episodes for', () => {
    expect(seasonState(season({ episodes: [] }))).toBe('absent')
  })
})

describe('seriesState rolls up every non-special episode', () => {
  it.each(ADJACENT_PAIRS)('%s outranks %s across seasons', (higher, lower) => {
    const seasons = [
      season({
        episodes: [episode({ id: 101, state: lower })],
        seasonNumber: 1,
      }),
      season({
        episodes: [episode({ id: 201, state: higher })],
        seasonNumber: 2,
      }),
    ]

    expect(seriesState(show(), seasons)).toBe(higher)
    expect(seriesState(show(), [...seasons].reverse())).toBe(higher)
  })

  it('⚠️ excludes specials, so an extra nobody grabbed cannot outrank the series', () => {
    const seasons = [
      specials({
        episodes: [
          episode({ id: 9001, seasonNumber: 0, state: 'needs_attention' }),
        ],
      }),
      season({ episodes: [episode({ hasFile: true })], seasonNumber: 1 }),
    ]

    expect(seriesState(show(), seasons)).toBe('available')
  })

  it("falls back to the show's own state when there are no seasons", () => {
    expect(seriesState(show({ state: 'downloading' }), [])).toBe('downloading')
  })

  it('falls back when the only season is specials', () => {
    expect(
      seriesState(show({ state: 'wanted' }), [
        specials({
          episodes: [episode({ seasonNumber: 0, state: 'available' })],
        }),
      ]),
    ).toBe('wanted')
  })

  it('falls back when no season lists any episodes', () => {
    expect(
      seriesState(show({ state: 'available' }), [season({ episodes: [] })]),
    ).toBe('available')
  })

  it('reads a show with no state of its own as absent in the fallback', () => {
    expect(seriesState(show(), [])).toBe('absent')
  })
})

describe('deleteCascade', () => {
  /**
   * A season whose episodes are described one entry each: `true` is a file on
   * disk, `false` is nothing (`wanted`), and a `MediaState` is no file in
   * that state - `'downloading'` for a grab in flight.
   *
   * ⚠️ Ids are `seasonNumber * 100 + n` so they are unique across seasons and
   * never equal to an episode *number* - the two are matched on different
   * fields and a fixture that conflated them would prove nothing.
   */
  function withEpisodes(
    seasonNumber: number,
    entries: readonly (boolean | MediaState)[],
    overrides: Partial<Season> = {},
  ): Season {
    return season({
      episodeCount: entries.length,
      episodeFileCount: entries.filter(entry => entry === true).length,
      episodes: entries.map((entry, index) =>
        episode({
          episodeNumber: index + 1,
          hasFile: entry === true,
          id: seasonNumber * 100 + index + 1,
          seasonNumber,
          ...(typeof entry === 'string' ? { state: entry } : {}),
        }),
      ),
      seasonNumber,
      ...overrides,
    })
  }

  describe('deleting a season', () => {
    it('stops at the season while another season still has files', () => {
      expect(
        deleteCascade([withEpisodes(1, [true]), withEpisodes(2, [true])], {
          seasonNumber: 1,
        }),
      ).toBe('none')
    })

    it.each(['downloading', 'importing', 'needs_attention', 'paused'] as const)(
      '⚠️ stops at the season while another season is only %s, with no job at all',
      state => {
        // A queued grab is a file that is about to exist - whoever started
        // it. The state comes from Sonarr's full queue, so a grab from its own
        // RSS feed holds the series back exactly like one this app made.
        expect(
          deleteCascade([withEpisodes(1, [true]), withEpisodes(2, [state])], {
            seasonNumber: 1,
          }),
        ).toBe('none')
      },
    )

    it('reaches the series when nothing else is left', () => {
      expect(
        deleteCascade([withEpisodes(1, [true]), withEpisodes(2, [false])], {
          seasonNumber: 1,
        }),
      ).toBe('series')
    })

    it('is not held back by an episode that is only wanted', () => {
      // Nothing has been grabbed for it, so nothing is about to land.
      expect(
        deleteCascade([withEpisodes(1, [true]), withEpisodes(2, ['wanted'])], {
          seasonNumber: 1,
        }),
      ).toBe('series')
    })
  })

  describe('deleting an episode', () => {
    it('stops at the episode while a sibling still has a file', () => {
      expect(
        deleteCascade([withEpisodes(1, [true, true])], {
          episodeId: 101,
          seasonNumber: 1,
        }),
      ).toBe('none')
    })

    it('stops at the episode while a sibling is only DOWNLOADING', () => {
      expect(
        deleteCascade([withEpisodes(1, [true, 'downloading'])], {
          episodeId: 101,
          seasonNumber: 1,
        }),
      ).toBe('none')
    })

    it('⚠️ is not held back by the target’s OWN in-flight download', () => {
      // The thing being deleted cannot be the reason its own season survives.
      expect(
        deleteCascade(
          [withEpisodes(1, ['downloading', false]), withEpisodes(2, [true])],
          { episodeId: 101, seasonNumber: 1 },
        ),
      ).toBe('season')
    })

    it('unmonitors the season when it was the last file in it', () => {
      expect(
        deleteCascade(
          [withEpisodes(1, [true, false]), withEpisodes(2, [true])],
          { episodeId: 101, seasonNumber: 1 },
        ),
      ).toBe('season')
    })

    it('reaches the series when it was the last file in the series', () => {
      expect(
        deleteCascade(
          [withEpisodes(1, [true, false]), withEpisodes(2, [false])],
          { episodeId: 101, seasonNumber: 1 },
        ),
      ).toBe('series')
    })

    it('stops one short of the series while another season is importing', () => {
      expect(
        deleteCascade(
          [withEpisodes(1, [true, false]), withEpisodes(2, ['importing'])],
          { episodeId: 101, seasonNumber: 1 },
        ),
      ).toBe('season')
    })

    it('cascades nowhere for an episode no listed season holds', () => {
      // The same answer `planShowDelete` gives an episode it cannot place.
      expect(
        deleteCascade([withEpisodes(1, [true])], {
          episodeId: 999,
          seasonNumber: 1,
        }),
      ).toBe('none')
      expect(
        deleteCascade([withEpisodes(1, [true])], {
          episodeId: 101,
          seasonNumber: 7,
        }),
      ).toBe('none')
    })
  })

  describe('⚠️ specials are a season on both sides of the rule', () => {
    it('lets season 0’s files keep another season’s delete from cascading', () => {
      // `0` is falsy. A rule written on truthiness would remove the series and
      // take the specials with it.
      expect(
        deleteCascade([withEpisodes(0, [true]), withEpisodes(1, [true])], {
          seasonNumber: 1,
        }),
      ).toBe('none')
    })

    it('lets a season 0 download keep another season’s delete from cascading', () => {
      expect(
        deleteCascade(
          [withEpisodes(0, ['downloading']), withEpisodes(1, [true])],
          { seasonNumber: 1 },
        ),
      ).toBe('none')
    })

    it('cascades from season 0 itself like any other season', () => {
      expect(
        deleteCascade([withEpisodes(0, [true]), withEpisodes(1, [false])], {
          seasonNumber: 0,
        }),
      ).toBe('series')
    })

    it('cascades from an episode of season 0', () => {
      expect(
        deleteCascade([withEpisodes(0, [true]), withEpisodes(1, [true])], {
          episodeId: 1,
          seasonNumber: 0,
        }),
      ).toBe('season')
    })
  })
})

describe('episodeState', () => {
  it.each<[MediaState, string, 'mute' | 'ok' | 'uv' | 'warn', boolean]>([
    ['available', 'in library', 'ok', false],
    ['wanted', 'wanted', 'mute', false],
    ['downloading', 'downloading', 'uv', true],
    ['importing', 'importing…', 'uv', true],
    ['needs_attention', 'needs your decision', 'warn', false],
    ['paused', 'paused', 'warn', false],
    ['absent', 'not downloaded', 'mute', false],
  ])('reads %s as "%s" (%s, live: %s)', (state, label, tone, live) => {
    expect(episodeState(episode({ state }))).toEqual({ label, live, tone })
  })

  it('⚠️ reads the state, not the disk: an upgrade in flight is downloading', () => {
    // A queue item outranks the file on the server (`deriveManagedState`), and
    // the row says what the server said.
    expect(
      episodeState(episode({ hasFile: true, state: 'downloading' })),
    ).toEqual({ label: 'downloading', live: true, tone: 'uv' })
  })

  it('reads an episode with no state on the wire as not downloaded', () => {
    expect(episodeState(episode({ state: undefined }))).toEqual({
      label: 'not downloaded',
      live: false,
      tone: 'mute',
    })
  })
})

describe('defaultSeasonNumber', () => {
  it('opens on the first season with a file', () => {
    expect(
      defaultSeasonNumber([
        specials(),
        season({ episodeFileCount: 0, seasonNumber: 1 }),
        season({ episodeFileCount: 4, seasonNumber: 2 }),
      ]),
    ).toBe(2)
  })

  it('skips specials when nothing is downloaded', () => {
    expect(defaultSeasonNumber([specials(), season({ seasonNumber: 1 })])).toBe(
      1,
    )
  })

  it('falls back to specials when that is all there is', () => {
    expect(defaultSeasonNumber([specials()])).toBe(0)
  })

  it('answers null for a series with no seasons at all', () => {
    expect(defaultSeasonNumber([])).toBeNull()
  })
})

describe('showMetaLine', () => {
  it('reads year · seasons · runtime · certification, with specials uncounted', () => {
    expect(
      showMetaLine(show(), [
        specials(),
        season({ seasonNumber: 1 }),
        season({ seasonNumber: 2 }),
      ]),
    ).toBe('2014 · 2 seasons · 29m · TV-MA')
  })

  it('singularises a one-season show', () => {
    expect(showMetaLine(show(), [season({ seasonNumber: 1 })])).toBe(
      '2014 · 1 season · 29m · TV-MA',
    )
  })

  it('⚠️ drops an unknown runtime rather than rendering an em dash mid-line', () => {
    // `runtime: 0` is upstream for "not known", and `formatRuntime` answers the
    // em dash for it - which would read as a broken field here.
    expect(showMetaLine(show({ runtime: 0 }), [season()])).toBe(
      '2014 · 1 season · TV-MA',
    )
  })

  it('drops every part it does not have', () => {
    expect(
      showMetaLine(
        show({ certification: undefined, runtime: undefined, year: undefined }),
        [],
      ),
    ).toBe('')
  })
})

describe('isMetadataMissing', () => {
  it('⚠️ detects the resolver placeholder, which answers 200 rather than 404', () => {
    // A `tvdb:` key always resolves: `MediaResolverService` catches an upstream
    // failure and emits `{ id, title: id }`. `notFound()` would be wrong twice.
    expect(
      isMetadataMissing({
        id: 'tvdb:99999999',
        title: 'tvdb:99999999',
        tvdbId: 99999999,
        type: DownloadType.Show,
      }),
    ).toBe(true)
  })

  it('leaves a real title alone', () => {
    expect(isMetadataMissing(show())).toBe(false)
  })
})

describe('isDownloadableState', () => {
  it.each<[MediaState, boolean]>([
    ['absent', true],
    ['wanted', true],
    ['available', false],
    ['downloading', false],
    ['importing', false],
    ['needs_attention', false],
    ['paused', false],
  ])('reads %s as downloadable: %s', (state, downloadable) => {
    // Nothing on disk and nothing queued - every other state either has its
    // files or already has a download under way.
    expect(isDownloadableState(state)).toBe(downloadable)
  })
})
