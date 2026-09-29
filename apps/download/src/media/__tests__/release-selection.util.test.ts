import type { Release } from '@lilnas/utils/download/types'

import {
  type EpisodeMappedRelease,
  pickBestRelease,
  pickSeasonReleases,
} from 'src/media/release-selection.util'

function release(
  overrides: Partial<EpisodeMappedRelease> = {},
): EpisodeMappedRelease {
  return {
    downloadAllowed: true,
    flaggedBad: false,
    guid: 'indexer://a',
    indexerId: 1,
    rejected: false,
    title: 'A release',
    ...overrides,
  }
}

const NONE = new Set<string>()

function guids(releases: readonly Release[]): string[] {
  return releases.map(r => r.guid)
}

describe('pickBestRelease', () => {
  it('returns undefined for an empty list', () => {
    expect(pickBestRelease([], NONE)).toBeUndefined()
  })

  it('returns the only candidate when there is one', () => {
    expect(pickBestRelease([release({ guid: 'g' })], NONE)?.guid).toBe('g')
  })

  // Radarr/Sonarr already return releases in their own preference order -
  // re-ranking by seeders or score would override the user's profile.
  it('keeps the upstream order over seeders and custom-format score', () => {
    const picked = pickBestRelease(
      [
        release({ customFormatScore: 0, guid: 'first', seeders: 1 }),
        release({ customFormatScore: 50, guid: 'popular', seeders: 900 }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('first')
  })

  // Usenet reports no seeders; a seeders sort used to sink it below every
  // torrent regardless of where upstream ranked it.
  it('does not sink a usenet release with no seeders', () => {
    const picked = pickBestRelease(
      [
        release({ guid: 'nzb', protocol: 'usenet', seeders: undefined }),
        release({ guid: 'torrent', protocol: 'torrent', seeders: 300 }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('nzb')
  })

  it('skips a release upstream will not allow downloading', () => {
    const picked = pickBestRelease(
      [
        release({ downloadAllowed: false, guid: 'blocked' }),
        release({ guid: 'ok' }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('ok')
  })

  it('drops flagged guids even when they come first', () => {
    const picked = pickBestRelease(
      [release({ guid: 'flagged' }), release({ guid: 'ok' })],
      new Set(['flagged']),
    )

    expect(picked?.guid).toBe('ok')
  })

  // Radarr/Sonarr would refuse the grab anyway, so a rejected release is
  // never a candidate regardless of its position.
  it('drops releases the upstream service already rejected', () => {
    const picked = pickBestRelease(
      [release({ guid: 'rejected', rejected: true }), release({ guid: 'ok' })],
      NONE,
    )

    expect(picked?.guid).toBe('ok')
  })

  it('returns undefined when no release is eligible', () => {
    const picked = pickBestRelease(
      [
        release({ guid: 'flagged' }),
        release({ guid: 'rejected', rejected: true }),
        release({ downloadAllowed: false, guid: 'blocked' }),
      ],
      new Set(['flagged']),
    )

    expect(picked).toBeUndefined()
  })
})

describe('pickSeasonReleases', () => {
  it('prefers the first eligible full-season pack over episode releases', () => {
    const picked = pickSeasonReleases(
      [
        release({ episodeNumbers: [1], guid: 'e01' }),
        release({ fullSeason: true, guid: 'pack-bad' }),
        release({ fullSeason: true, guid: 'pack' }),
        release({ fullSeason: true, guid: 'pack-later' }),
      ],
      new Set(['pack-bad']),
      [1, 2, 3],
    )

    expect(guids(picked)).toEqual(['pack'])
  })

  it('picks the first eligible release per missing episode, in upstream order', () => {
    const picked = pickSeasonReleases(
      [
        release({ episodeNumbers: [2], guid: 'e02-a' }),
        release({ episodeNumbers: [1], guid: 'e01-a' }),
        release({ episodeNumbers: [2], guid: 'e02-b' }),
        release({ episodeNumbers: [1], guid: 'e01-b' }),
      ],
      NONE,
      [1, 2],
    )

    expect(guids(picked)).toEqual(['e02-a', 'e01-a'])
  })

  it('never picks releases whose episodes overlap, including multi-episode ones', () => {
    const picked = pickSeasonReleases(
      [
        release({ episodeNumbers: [2], guid: 'e02' }),
        // Overlaps E02 already covered - skipped even though it adds E01.
        release({ episodeNumbers: [1, 2], guid: 'e01e02' }),
        release({ episodeNumbers: [3, 4], guid: 'e03e04' }),
        // Overlaps E03 from the double above.
        release({ episodeNumbers: [3], guid: 'e03' }),
        release({ episodeNumbers: [1], guid: 'e01' }),
      ],
      NONE,
      [1, 2, 3, 4],
    )

    expect(guids(picked)).toEqual(['e02', 'e03e04', 'e01'])
  })

  it('skips releases that cover no missing episode', () => {
    const picked = pickSeasonReleases(
      [
        release({ episodeNumbers: [5], guid: 'has-file' }),
        release({ episodeNumbers: [], guid: 'unparsed' }),
        release({ guid: 'no-numbers' }),
        release({ episodeNumbers: [6], guid: 'e06' }),
      ],
      NONE,
      [6],
    )

    expect(guids(picked)).toEqual(['e06'])
  })

  // A double whose other half already has a file is still the right grab
  // for the missing half - and it then blocks a second copy of that half.
  it('takes a multi-episode release that covers any missing episode', () => {
    const picked = pickSeasonReleases(
      [
        release({ episodeNumbers: [1, 2], guid: 'e01e02' }),
        release({ episodeNumbers: [1], guid: 'e01' }),
      ],
      NONE,
      [2],
    )

    expect(guids(picked)).toEqual(['e01e02'])
  })

  it('prefers the mapped episode numbers over the parsed ones', () => {
    const picked = pickSeasonReleases(
      [
        // Parsed as E10 (absolute numbering) but Sonarr maps it to E01.
        release({
          episodeNumbers: [10],
          guid: 'absolute',
          mappedEpisodeNumbers: [1],
        }),
        release({ episodeNumbers: [1], guid: 'e01' }),
      ],
      NONE,
      [1],
    )

    expect(guids(picked)).toEqual(['absolute'])
  })

  it('applies the eligibility filter to episode releases too', () => {
    const picked = pickSeasonReleases(
      [
        release({ episodeNumbers: [1], guid: 'rejected', rejected: true }),
        release({
          downloadAllowed: false,
          episodeNumbers: [1],
          guid: 'blocked',
        }),
        release({ episodeNumbers: [1], guid: 'flagged' }),
        release({ episodeNumbers: [1], guid: 'ok' }),
      ],
      new Set(['flagged']),
      [1],
    )

    expect(guids(picked)).toEqual(['ok'])
  })

  it('returns an empty list when no release is eligible', () => {
    expect(
      pickSeasonReleases(
        [
          release({ fullSeason: true, guid: 'pack', rejected: true }),
          release({ episodeNumbers: [1], guid: 'flagged' }),
        ],
        new Set(['flagged']),
        [1],
      ),
    ).toEqual([])
    expect(pickSeasonReleases([], NONE, [1])).toEqual([])
  })
})
