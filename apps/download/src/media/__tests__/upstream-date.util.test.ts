import { toUpstreamIsoDateTime } from 'src/media/upstream-date.util'

describe('toUpstreamIsoDateTime', () => {
  it('normalises an *arr timestamp to a full ISO datetime', () => {
    expect(toUpstreamIsoDateTime('2024-03-13T06:08:15Z')).toBe(
      '2024-03-13T06:08:15.000Z',
    )
  })

  it('keeps sub-second precision and converts an offset to UTC', () => {
    expect(toUpstreamIsoDateTime('2024-03-13T08:08:15.25+02:00')).toBe(
      '2024-03-13T06:08:15.250Z',
    )
  })

  it.each([undefined, null, ''])(
    'returns undefined for a missing value (%p), never "now"',
    value => {
      expect(toUpstreamIsoDateTime(value)).toBeUndefined()
    },
  )

  it('returns undefined for an unparseable value', () => {
    expect(toUpstreamIsoDateTime('not a date')).toBeUndefined()
  })

  // .NET's DateTime.MinValue - what Sonarr/Radarr serialise for an unset
  // date, e.g. `added` on a lookup hit outside the library.
  it.each(['0001-01-01T00:00:00Z', '0001-01-01T07:53:00Z'])(
    'returns undefined for the DateTime.MinValue sentinel %p',
    value => {
      expect(toUpstreamIsoDateTime(value)).toBeUndefined()
    },
  )
})
