import type { HistoryRecordLike } from 'src/media/release-history.util'
import {
  historyValue,
  mapFilesToReleases,
} from 'src/media/release-history.util'

import {
  RADARR_HISTORY,
  SONARR_HISTORY,
} from './fixtures/release-history.fixtures'

/** A minimal grab/import pair sharing one downloadId, for the edge cases. */
function pair(
  overrides: {
    downloadId?: string
    fileId?: string | null
    grab?: Partial<HistoryRecordLike>
    import?: Partial<HistoryRecordLike>
  } = {},
): [HistoryRecordLike, HistoryRecordLike] {
  const downloadId = overrides.downloadId ?? 'DL1'
  const fileId = overrides.fileId === undefined ? '1' : overrides.fileId

  // `data` is replaced wholesale rather than merged, so a test that cares
  // about key casing doesn't end up with both `guid` and `Guid` in the bag.
  return [
    {
      date: '2026-01-01T00:00:00Z',
      downloadId,
      eventType: 'grabbed',
      sourceTitle: 'Some Release 2026 1080p WEB-DL-GROUP',
      ...overrides.grab,
      data: overrides.grab?.data ?? { guid: 'guid-1' },
    },
    {
      date: '2026-01-01T00:10:00Z',
      downloadId,
      eventType: 'downloadFolderImported',
      ...overrides.import,
      data: overrides.import?.data ?? { fileId },
    },
  ]
}

describe('historyValue', () => {
  it('reads a key out of the data bag', () => {
    expect(historyValue({ data: { guid: 'abc' } }, 'guid')).toBe('abc')
  })

  it('matches keys case-insensitively in both directions', () => {
    expect(historyValue({ data: { Guid: 'abc' } }, 'guid')).toBe('abc')
    expect(historyValue({ data: { guid: 'abc' } }, 'GUID')).toBe('abc')
    expect(historyValue({ data: { IndexerId: '4' } }, 'indexerId')).toBe('4')
  })

  it('treats an empty string and null alike as absent', () => {
    expect(historyValue({ data: { guid: '' } }, 'guid')).toBeUndefined()
    expect(historyValue({ data: { guid: null } }, 'guid')).toBeUndefined()
  })

  it('returns undefined when the key or the bag is missing', () => {
    expect(historyValue({ data: { other: 'x' } }, 'guid')).toBeUndefined()
    expect(historyValue({ data: null }, 'guid')).toBeUndefined()
    expect(historyValue({}, 'guid')).toBeUndefined()
  })
})

describe('mapFilesToReleases', () => {
  it('returns an empty map for an empty record list', () => {
    expect(mapFilesToReleases([])).toEqual(new Map())
  })

  it('round-trips a Radarr file id back to its grabbed release', () => {
    const releases = mapFilesToReleases(RADARR_HISTORY)

    expect(releases.size).toBe(1)
    expect(releases.get(9012)).toEqual({
      downloadId: '8F1A2B3C4D5E6F708192A3B4C5D6E7F8',
      episodeId: undefined,
      guid: 'https://nzbgeek.info/geekseek.php?guid=163afb8a6c3d4e1fa0b27c99d15e4471',
      indexer: 'NzbGeek',
      indexerId: 4,
      protocol: 'usenet',
      publishDate: '2026-07-02T00:00:00Z',
      releaseGroup: 'TERMINAL',
      size: 4419036486,
      title: 'The Matrix 1999 2160p UHD BluRay x265-TERMINAL',
    })
  })

  it('round-trips each Sonarr episode file to its own release', () => {
    const releases = mapFilesToReleases(SONARR_HISTORY)

    expect(releases.size).toBe(2)
    expect(releases.get(77301)).toEqual({
      downloadId: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
      // Off the grabbed record's top-level field, not out of `data`.
      episodeId: 4411,
      guid: 'https://althub.co.za/details/6f2c0e1d9b7a4c85',
      indexer: 'AltHub',
      // Sonarr's history carries only the indexer name.
      indexerId: undefined,
      protocol: 'torrent',
      publishDate: '2026-06-14T21:58:00Z',
      releaseGroup: 'FLUX',
      size: 3155872154,
      title: 'Severance S02E01 2160p ATVP WEB-DL DDP5 1 Atmos H 265-FLUX',
    })
    expect(releases.get(77302)).toMatchObject({
      episodeId: 4412,
      guid: 'https://althub.co.za/details/b93d5a70c2e14f66',
      releaseGroup: 'NTb',
    })
  })

  it('omits an import with no matching grabbed record', () => {
    const [, importRecord] = pair()

    expect(mapFilesToReleases([importRecord]).size).toBe(0)
  })

  it('omits an import whose grabbed record carries no guid', () => {
    const records = pair({ grab: { data: { guid: '' } } })

    expect(mapFilesToReleases(records).size).toBe(0)
  })

  it('skips an import with no fileId rather than defaulting it to 0', () => {
    const releases = mapFilesToReleases(pair({ fileId: null }))

    expect(releases.size).toBe(0)
    expect(releases.has(0)).toBe(false)
  })

  it('skips an import with no downloadId to join on', () => {
    const [grab, importRecord] = pair()

    expect(
      mapFilesToReleases([grab, { ...importRecord, downloadId: null }]).size,
    ).toBe(0)
  })

  it('resolves duplicate imports of one file id to the newest', () => {
    const records: HistoryRecordLike[] = [
      ...pair({
        downloadId: 'OLD',
        grab: { data: { guid: 'old-guid' } },
        import: { date: '2026-01-01T00:00:00Z' },
      }),
      ...pair({
        downloadId: 'NEW',
        grab: { data: { guid: 'new-guid' } },
        import: { date: '2026-03-01T00:00:00Z' },
      }),
    ]

    expect(mapFilesToReleases(records).get(1)?.guid).toBe('new-guid')
    // Order in the list must not matter.
    expect(mapFilesToReleases([...records].reverse()).get(1)?.guid).toBe(
      'new-guid',
    )
  })

  it('sorts an undated import as the oldest', () => {
    const records: HistoryRecordLike[] = [
      ...pair({
        downloadId: 'DATED',
        grab: { data: { guid: 'dated-guid' } },
        import: { date: '2026-01-01T00:00:00Z' },
      }),
      ...pair({
        downloadId: 'UNDATED',
        grab: { data: { guid: 'undated-guid' } },
        import: { date: undefined },
      }),
    ]

    expect(mapFilesToReleases(records).get(1)?.guid).toBe('dated-guid')
  })

  it('parses the string numbers and drops the malformed ones', () => {
    const releases = mapFilesToReleases(
      pair({
        grab: {
          data: {
            guid: 'guid-1',
            indexerId: '12',
            size: 'not-a-number',
          },
        },
      }),
    )

    expect(releases.get(1)).toMatchObject({ indexerId: 12, size: undefined })
  })

  it('maps each protocol value positionally', () => {
    const protocolOf = (protocol: string | null) =>
      mapFilesToReleases(pair({ grab: { data: { guid: 'g', protocol } } })).get(
        1,
      )?.protocol

    expect(protocolOf('1')).toBe('usenet')
    expect(protocolOf('2')).toBe('torrent')
    expect(protocolOf('0')).toBe('unknown')
    expect(protocolOf('7')).toBe('unknown')
    expect(protocolOf('nonsense')).toBe('unknown')
    // Absent entirely is not the same as "reported as unknown".
    expect(protocolOf(null)).toBeUndefined()
  })

  it('reads data keys case-insensitively on the grabbed record', () => {
    const releases = mapFilesToReleases(
      pair({
        grab: {
          data: {
            Guid: 'cased-guid',
            Indexer: 'NzbGeek',
            IndexerId: '4',
            Protocol: '1',
            Size: '100',
          },
        },
      }),
    )

    expect(releases.get(1)).toMatchObject({
      guid: 'cased-guid',
      indexer: 'NzbGeek',
      indexerId: 4,
      protocol: 'usenet',
      size: 100,
    })
  })

  it('falls back to the guid when the grabbed record has no sourceTitle', () => {
    const releases = mapFilesToReleases(pair({ grab: { sourceTitle: null } }))

    expect(releases.get(1)?.title).toBe('guid-1')
  })

  it('ignores event types other than grabbed and downloadFolderImported', () => {
    const records: HistoryRecordLike[] = [
      ...pair(),
      {
        date: '2026-02-01T00:00:00Z',
        downloadId: 'DL1',
        eventType: 'downloadIgnored',
        data: { fileId: '1' },
      },
    ]

    expect(mapFilesToReleases(records).get(1)?.guid).toBe('guid-1')
  })
})
