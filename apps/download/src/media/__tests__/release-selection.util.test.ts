import type { Release } from '@lilnas/utils/download/types'

import { pickBestRelease } from 'src/media/release-selection.util'

function release(overrides: Partial<Release> = {}): Release {
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

describe('pickBestRelease', () => {
  it('returns undefined for an empty list', () => {
    expect(pickBestRelease([], NONE)).toBeUndefined()
  })

  it('returns the only candidate when there is one', () => {
    expect(pickBestRelease([release({ guid: 'g' })], NONE)?.guid).toBe('g')
  })

  it('prefers the highest customFormatScore', () => {
    const picked = pickBestRelease(
      [
        release({ customFormatScore: 5, guid: 'low' }),
        release({ customFormatScore: 50, guid: 'high' }),
        release({ customFormatScore: 20, guid: 'mid' }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('high')
  })

  it('breaks a score tie on seeders', () => {
    const picked = pickBestRelease(
      [
        release({ customFormatScore: 10, guid: 'few', seeders: 2 }),
        release({ customFormatScore: 10, guid: 'many', seeders: 200 }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('many')
  })

  it('breaks a score-and-seeders tie on publish date, newest first', () => {
    const picked = pickBestRelease(
      [
        release({ guid: 'old', publishDate: '2020-01-01T00:00:00Z' }),
        release({ guid: 'new', publishDate: '2026-01-01T00:00:00Z' }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('new')
  })

  // A missing score/seeder count sorts as 0 rather than knocking the release
  // out - an indexer that reports neither still returns usable releases.
  it('treats a missing score or seeder count as zero, not as disqualifying', () => {
    const picked = pickBestRelease(
      [
        release({ guid: 'bare' }),
        release({ customFormatScore: 1, guid: 'scored' }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('scored')
  })

  it('sorts a release with an unparseable publish date last', () => {
    const picked = pickBestRelease(
      [
        release({ guid: 'garbage', publishDate: 'not-a-date' }),
        release({ guid: 'dated', publishDate: '2020-01-01T00:00:00Z' }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('dated')
  })

  it('drops flagged guids even when they would otherwise win', () => {
    const picked = pickBestRelease(
      [
        release({ customFormatScore: 100, guid: 'flagged' }),
        release({ customFormatScore: 1, guid: 'ok' }),
      ],
      new Set(['flagged']),
    )

    expect(picked?.guid).toBe('ok')
  })

  // Radarr/Sonarr would refuse the grab anyway, so a rejected release is
  // never a candidate regardless of how well it scores.
  it('drops releases the upstream service already rejected', () => {
    const picked = pickBestRelease(
      [
        release({ customFormatScore: 100, guid: 'rejected', rejected: true }),
        release({ customFormatScore: 1, guid: 'ok' }),
      ],
      NONE,
    )

    expect(picked?.guid).toBe('ok')
  })

  it('returns undefined when every release is flagged or rejected', () => {
    const picked = pickBestRelease(
      [
        release({ guid: 'flagged' }),
        release({ guid: 'rejected', rejected: true }),
      ],
      new Set(['flagged']),
    )

    expect(picked).toBeUndefined()
  })

  it('does not sort the caller’s array in place', () => {
    const releases = [
      release({ customFormatScore: 1, guid: 'low' }),
      release({ customFormatScore: 9, guid: 'high' }),
    ]

    pickBestRelease(releases, NONE)

    expect(releases.map(r => r.guid)).toEqual(['low', 'high'])
  })
})
