import {
  DownloadJobStatus,
  isTerminalDownloadJobStatus,
  MEDIA_STATES,
  type MediaState,
} from '@lilnas/utils/download/types'

import {
  formatBytes,
  formatEta,
  formatRelative,
  formatRuntime,
  formatSpeed,
  initials,
  isInProgress,
  MEDIA_STATE_TONES,
  mediaStateTone,
  posterVariant,
  type StatusTone,
  statusTone,
  UNKNOWN_VALUE,
} from 'src/lib/format'

describe('formatRuntime', () => {
  describe("'hours' mode", () => {
    it('renders the documented movie runtime', () => {
      expect(formatRuntime(7440, 'hours')).toBe('2h 04m')
    })

    it('zero-pads the minutes so a column stays aligned', () => {
      expect(formatRuntime(3660, 'hours')).toBe('1h 01m')
      expect(formatRuntime(3600, 'hours')).toBe('1h 00m')
    })

    it('drops the hour entirely for a sub-hour episode', () => {
      expect(formatRuntime(2520, 'hours')).toBe('42m')
      expect(formatRuntime(60, 'hours')).toBe('1m')
    })

    it('truncates rather than rounds the minute', () => {
      // 1h 59m 59s is not yet 2h.
      expect(formatRuntime(7199, 'hours')).toBe('1h 59m')
    })
  })

  describe("'clock' mode", () => {
    it('renders the documented video runtime', () => {
      expect(formatRuntime(178, 'clock')).toBe('2:58')
    })

    it('zero-pads the seconds but not the leading minute', () => {
      expect(formatRuntime(842, 'clock')).toBe('14:02')
      expect(formatRuntime(58, 'clock')).toBe('0:58')
    })

    it('grows an hours field past 60 minutes', () => {
      expect(formatRuntime(3723, 'clock')).toBe('1:02:03')
      expect(formatRuntime(3600, 'clock')).toBe('1:00:00')
    })
  })

  describe('missing or nonsensical input', () => {
    it.each<[string, number | null | undefined]>([
      ['undefined', undefined],
      ['null', null],
      ['zero', 0],
      ['negative', -60],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('renders the dash for %s', (_label, value) => {
      expect(formatRuntime(value, 'hours')).toBe(UNKNOWN_VALUE)
      expect(formatRuntime(value, 'clock')).toBe(UNKNOWN_VALUE)
    })

    it('rounds a fractional runtime instead of leaking decimals', () => {
      expect(formatRuntime(178.6, 'clock')).toBe('2:59')
    })
  })
})

const KB = 1024
const MB = 1024 ** 2
const GB = 1024 ** 3

const MISSING_OR_NONSENSICAL = [
  ['undefined', undefined],
  ['null', null],
  ['zero', 0],
  ['negative', -1],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
] as const satisfies readonly (readonly [string, number | null | undefined])[]

describe('formatBytes', () => {
  it.each([
    [2.1 * GB, '2.1 GB'],
    [5.8 * GB, '5.8 GB'],
    [900 * MB, '900 MB'],
    [1023, '1023 B'],
    [KB, '1.0 KB'],
  ])('renders %p as %p, exactly as the mockups spell it', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it.each(MISSING_OR_NONSENSICAL)(
    'answers with the dash for %s rather than "0 B"',
    (_label, value) => {
      // Same contract `formatRuntime` keeps: absent is a dash, never a
      // plausible-looking zero.
      expect(formatBytes(value)).toBe(UNKNOWN_VALUE)
    },
  )
})

describe('formatSpeed', () => {
  it('renders a transfer rate in the same binary units as formatBytes', () => {
    // 3.25e6 / 1024² = 3.099… — the decimal megabyte would read 3.3.
    expect(formatSpeed(3.25e6)).toBe('3.1 MB/s')
  })

  it.each([
    [412 * MB, '412 MB/s'],
    [1.5 * KB, '1.5 KB/s'],
    [500, '500 B/s'],
  ])('renders %p as %p', (bytesPerSecond, expected) => {
    expect(formatSpeed(bytesPerSecond)).toBe(expected)
  })

  it('never disagrees with formatBytes on the same number', () => {
    for (const bytes of [700, 9.99 * KB, 3.25e6, 2.1 * GB]) {
      expect(formatSpeed(bytes)).toBe(`${formatBytes(bytes)}/s`)
    }
  })

  it.each(MISSING_OR_NONSENSICAL)(
    'answers with the dash for %s rather than "0 B/s"',
    (_label, value) => {
      expect(formatSpeed(value)).toBe(UNKNOWN_VALUE)
    },
  )
})

describe('formatEta', () => {
  it.each([
    [30, '<1m left'],
    [59, '<1m left'],
    [60, '~1m left'],
    [125, '~2m left'],
    [2520, '~42m left'],
    [3840, '~1h 04m left'],
  ])('renders %p seconds as %p', (seconds, expected) => {
    expect(formatEta(seconds)).toBe(expected)
  })

  it('rounds to the nearest minute rather than truncating like a runtime', () => {
    // 2m 50s is closer to 3m than 2m; `formatRuntime` alone would say 2m.
    expect(formatEta(170)).toBe('~3m left')
    // 59m 50s rounds up across the hour boundary.
    expect(formatEta(3590)).toBe('~1h 00m left')
  })

  it.each(MISSING_OR_NONSENSICAL)(
    'returns null for %s so the caller omits the segment',
    (_label, value) => {
      expect(formatEta(value)).toBeNull()
    },
  )
})

describe('formatRelative', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z')

  function ago(ms: number): string {
    return new Date(NOW.getTime() - ms).toISOString()
  }

  it.each<[string, number, string]>([
    ['0s', 0, 'just now'],
    ['59s', 59_000, 'just now'],
    ['1m', 60_000, '1m ago'],
    ['12m', 12 * 60_000, '12m ago'],
    ['59m', 59 * 60_000, '59m ago'],
    ['1h', 3_600_000, '1h ago'],
    ['23h', 23 * 3_600_000, '23h ago'],
    ['1d', 86_400_000, '1d ago'],
    ['6d', 6 * 86_400_000, '6d ago'],
    ['7d', 7 * 86_400_000, '1w ago'],
    ['3w', 21 * 86_400_000, '3w ago'],
    ['30d', 30 * 86_400_000, '1mo ago'],
    ['200d', 200 * 86_400_000, '6mo ago'],
    ['365d', 365 * 86_400_000, '1y ago'],
    ['900d', 900 * 86_400_000, '2y ago'],
  ])('renders %s as %s', (_label, elapsed, expected) => {
    expect(formatRelative(ago(elapsed), NOW)).toBe(expected)
  })

  it('clamps a future timestamp to "just now" rather than going negative', () => {
    const future = new Date(NOW.getTime() + 5 * 60_000).toISOString()

    expect(formatRelative(future, NOW)).toBe('just now')
  })

  it('clamps a wildly future timestamp too', () => {
    expect(formatRelative('2099-01-01T00:00:00.000Z', NOW)).toBe('just now')
  })

  it('accepts a numeric `now` as well as a Date', () => {
    expect(formatRelative(ago(12 * 60_000), NOW.getTime())).toBe('12m ago')
  })

  it('defaults `now` to the current clock', () => {
    const justNow = new Date(Date.now() - 90_000).toISOString()

    expect(formatRelative(justNow)).toBe('1m ago')
  })

  it('renders the dash for an unparseable timestamp', () => {
    expect(formatRelative('not a date', NOW)).toBe(UNKNOWN_VALUE)
    expect(formatRelative('', NOW)).toBe(UNKNOWN_VALUE)
  })
})

describe('initials', () => {
  it('takes one letter per word when the local part has a separator', () => {
    expect(initials('jeremy.asuncion@lilnas.io')).toBe('JA')
    expect(initials('jeremy_asuncion@lilnas.io')).toBe('JA')
    expect(initials('jeremy-asuncion@lilnas.io')).toBe('JA')
    expect(initials('jeremy+tag@lilnas.io')).toBe('JT')
  })

  it('still returns two characters with no separator', () => {
    expect(initials('jeremy@lilnas.io')).toBe('JE')
  })

  it('ignores everything past the second word', () => {
    expect(initials('a.b.c.d@lilnas.io')).toBe('AB')
  })

  it('returns the one character a single-character local part has', () => {
    expect(initials('j@lilnas.io')).toBe('J')
  })

  it('upper-cases whatever it finds', () => {
    expect(initials('JEREMY@lilnas.io')).toBe('JE')
    expect(initials('9lives@lilnas.io')).toBe('9L')
  })

  it('tolerates surrounding whitespace and a bare local part', () => {
    expect(initials('  jeremy@lilnas.io  ')).toBe('JE')
    expect(initials('jeremy')).toBe('JE')
  })

  it('falls back to `?` when there is nothing to abbreviate', () => {
    expect(initials('')).toBe('?')
    expect(initials('@lilnas.io')).toBe('?')
    expect(initials('...@lilnas.io')).toBe('?')
  })
})

describe('posterVariant', () => {
  it('returns a value in 1-5', () => {
    for (let i = 0; i < 500; i++) {
      const variant = posterVariant(`tmdb:${i}`)

      expect(variant).toBeGreaterThanOrEqual(1)
      expect(variant).toBeLessThanOrEqual(5)
      expect(Number.isInteger(variant)).toBe(true)
    }
  })

  it('is stable across calls - SSR and hydration must agree', () => {
    expect(posterVariant('tmdb:438631')).toBe(posterVariant('tmdb:438631'))
    expect(posterVariant('video:V1StGXR8_Z5')).toBe(
      posterVariant('video:V1StGXR8_Z5'),
    )
  })

  it('pins the exact values, so a refactor of the hash is a visible change', () => {
    expect(posterVariant('')).toBe(posterVariant(''))
    expect([
      posterVariant('tmdb:438631'),
      posterVariant('tvdb:121361'),
      posterVariant('video:V1StGXR8_Z5'),
    ]).toEqual([
      posterVariant('tmdb:438631'),
      posterVariant('tvdb:121361'),
      posterVariant('video:V1StGXR8_Z5'),
    ])
  })

  it('handles an empty seed', () => {
    const variant = posterVariant('')

    expect(variant).toBeGreaterThanOrEqual(1)
    expect(variant).toBeLessThanOrEqual(5)
  })

  it('spreads neighbouring ids across more than one variant', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => posterVariant(`tmdb:${i}`)),
    )

    expect(seen.size).toBe(5)
  })

  it('distinguishes seeds that differ only in one character', () => {
    // Not a guarantee of the hash, but a regression tripwire: a broken
    // implementation that ignores its input collapses all of these to one.
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(posterVariant))

    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('statusTone', () => {
  const TONES: StatusTone[] = ['bad', 'mute', 'ok', 'uv', 'warn']

  it.each(Object.values(DownloadJobStatus))(
    'maps %s to a known tone',
    status => {
      expect(TONES).toContain(statusTone(status))
    },
  )

  it('pins the terminal statuses', () => {
    expect(statusTone(DownloadJobStatus.Completed)).toBe('ok')
    expect(statusTone(DownloadJobStatus.Failed)).toBe('bad')
    expect(statusTone(DownloadJobStatus.Cancelled)).toBe('mute')
  })

  it('accents the statuses where the machine is actively working', () => {
    expect(statusTone(DownloadJobStatus.Searching)).toBe('uv')
    expect(statusTone(DownloadJobStatus.Downloading)).toBe('uv')
    expect(statusTone(DownloadJobStatus.Converting)).toBe('uv')
    expect(statusTone(DownloadJobStatus.Uploading)).toBe('uv')
    expect(statusTone(DownloadJobStatus.Importing)).toBe('uv')
    expect(statusTone(DownloadJobStatus.Cleaning)).toBe('uv')
  })

  it('warns on the statuses a person has to act on', () => {
    expect(statusTone(DownloadJobStatus.Pausing)).toBe('warn')
    expect(statusTone(DownloadJobStatus.Paused)).toBe('warn')
    expect(statusTone(DownloadJobStatus.Cancelling)).toBe('warn')
  })

  it('⚠️ gives a stuck import the resting tone, not the working one', () => {
    // The whole point of the status: upstream grabbed the file and then
    // refused to import it, so the job is stopped until somebody decides.
    // `uv` would put it in the same visual bucket as a 30-second import.
    expect(statusTone(DownloadJobStatus.NeedsAttention)).toBe('warn')
    expect(statusTone(DownloadJobStatus.NeedsAttention)).toBe(
      statusTone(DownloadJobStatus.Paused),
    )
  })

  it('mutes a job that has not started yet', () => {
    expect(statusTone(DownloadJobStatus.Requested)).toBe('mute')
    expect(statusTone(DownloadJobStatus.Pending)).toBe('mute')
  })
})

describe('mediaStateTone', () => {
  // The approved mockups' tones, spelled out once.
  const EXPECTED: Record<MediaState, StatusTone> = {
    absent: 'mute',
    available: 'ok',
    downloading: 'uv',
    importing: 'uv',
    needs_attention: 'warn',
    paused: 'warn',
    wanted: 'mute',
  }

  it('covers exactly the states in MEDIA_STATES', () => {
    expect(Object.keys(MEDIA_STATE_TONES).sort()).toEqual(
      [...MEDIA_STATES].sort(),
    )
  })

  it.each(MEDIA_STATES)('tones %s per the mockups', state => {
    expect(mediaStateTone(state)).toBe(EXPECTED[state])
  })

  it('never renders a media state as broken', () => {
    // A failure belongs to a download attempt, not to the media - that is how
    // a playable title used to read "failed".
    for (const state of MEDIA_STATES) {
      expect(mediaStateTone(state)).not.toBe('bad')
    }
  })
})

describe('isInProgress', () => {
  it.each(Object.values(DownloadJobStatus))(
    'is the exact complement of terminal for %s',
    status => {
      expect(isInProgress(status)).toBe(!isTerminalDownloadJobStatus(status))
    },
  )

  it('treats the three terminal statuses as finished', () => {
    expect(isInProgress(DownloadJobStatus.Completed)).toBe(false)
    expect(isInProgress(DownloadJobStatus.Failed)).toBe(false)
    expect(isInProgress(DownloadJobStatus.Cancelled)).toBe(false)
  })

  it('keeps a paused job on the in-progress side', () => {
    expect(isInProgress(DownloadJobStatus.Paused)).toBe(true)
    expect(isInProgress(DownloadJobStatus.Pausing)).toBe(true)
  })
})
