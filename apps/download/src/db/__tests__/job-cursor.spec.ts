import {
  computeFilterKey,
  decodeJobCursor,
  encodeJobCursor,
  JobCursor,
} from 'src/db/job-cursor'

describe('job cursor codec', () => {
  const filterKey = computeFilterKey({ status: ['downloading'] })

  it('round-trips a cursor through encode -> decode', () => {
    const cursor: JobCursor = {
      createdAtMs: 1_700_000_000_000,
      filterKey,
      id: 'abc123',
    }

    const decoded = decodeJobCursor(encodeJobCursor(cursor), filterKey)

    expect(decoded).toEqual(cursor)
  })

  it('accepts nanoid-shaped ids containing "-" and "_"', () => {
    const cursor: JobCursor = {
      createdAtMs: 1_700_000_000_000,
      filterKey,
      id: 'a-b_C-1_2',
    }

    const decoded = decodeJobCursor(encodeJobCursor(cursor), filterKey)

    expect(decoded?.id).toBe('a-b_C-1_2')
  })

  it('decodes createdAtMs as a real number, not a numeric string', () => {
    const cursor: JobCursor = { createdAtMs: 42, filterKey, id: 'x' }
    const decoded = decodeJobCursor(encodeJobCursor(cursor), filterKey)

    expect(typeof decoded?.createdAtMs).toBe('number')
    expect(decoded?.createdAtMs).toBe(42)
  })

  it('rejects an empty string', () => {
    expect(decodeJobCursor('', filterKey)).toBeUndefined()
  })

  it('rejects a non-base64 garbage string', () => {
    expect(decodeJobCursor('!!!not-base64!!!', filterKey)).toBeUndefined()
  })

  it('rejects a payload missing the id field', () => {
    const raw = Buffer.from(`123::${filterKey}`, 'utf8').toString('base64url')
    expect(decodeJobCursor(raw, filterKey)).toBeUndefined()
  })

  it('rejects a payload missing the filterKey field', () => {
    const raw = Buffer.from('123:abc:', 'utf8').toString('base64url')
    expect(decodeJobCursor(raw, filterKey)).toBeUndefined()
  })

  it('rejects a payload with only one field (no colons)', () => {
    const raw = Buffer.from('not-a-real-cursor', 'utf8').toString('base64url')
    expect(decodeJobCursor(raw, filterKey)).toBeUndefined()
  })

  it('rejects a non-numeric timestamp', () => {
    const raw = Buffer.from(`not-a-number:abc:${filterKey}`, 'utf8').toString(
      'base64url',
    )
    expect(decodeJobCursor(raw, filterKey)).toBeUndefined()
  })

  it('rejects an empty timestamp field rather than defaulting to 0', () => {
    const raw = Buffer.from(`:abc:${filterKey}`, 'utf8').toString('base64url')
    expect(decodeJobCursor(raw, filterKey)).toBeUndefined()
  })

  it('rejects a mismatched filter key', () => {
    const cursor: JobCursor = { createdAtMs: 1, filterKey, id: 'x' }
    const otherFilterKey = computeFilterKey({ status: ['completed'] })

    expect(
      decodeJobCursor(encodeJobCursor(cursor), otherFilterKey),
    ).toBeUndefined()
  })
})

describe('computeFilterKey', () => {
  it('is deterministic for the same filter', () => {
    const a = computeFilterKey({ status: ['a', 'b'], type: 'movie' })
    const b = computeFilterKey({ status: ['a', 'b'], type: 'movie' })
    expect(a).toBe(b)
  })

  it('is independent of key order', () => {
    const a = computeFilterKey({ status: ['a', 'b'], type: 'movie' })
    const b = computeFilterKey({ type: 'movie', status: ['a', 'b'] })
    expect(a).toBe(b)
  })

  it('is sensitive to array element order (order is meaningful)', () => {
    const a = computeFilterKey({ status: ['a', 'b'] })
    const b = computeFilterKey({ status: ['b', 'a'] })
    expect(a).not.toBe(b)
  })

  it('produces different hashes for different filters', () => {
    const a = computeFilterKey({ type: 'movie' })
    const b = computeFilterKey({ type: 'show' })
    expect(a).not.toBe(b)
  })

  it('never contains a colon (safe to embed in a cursor)', () => {
    const key = computeFilterKey({ status: ['a:b'] })
    expect(key).not.toContain(':')
  })

  it('is sensitive to Date field values (not collapsed to the same {})', () => {
    const a = computeFilterKey({ createdFrom: new Date('2026-01-01') })
    const b = computeFilterKey({ createdFrom: new Date('2026-06-01') })
    expect(a).not.toBe(b)
  })
})
