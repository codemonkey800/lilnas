import { VideoProgressSchema } from '@lilnas/utils/download/schema'

import {
  createLineSplitter,
  createProgressReducer,
  parseYtdlpFormatCountLine,
  parseYtdlpProgressLine,
  YTDLP_PROGRESS_ARGS,
  YTDLP_PROGRESS_PREFIX,
} from 'src/download/ytdlp-progress'

// Real yt-dlp 2026.08.19 output, verbatim unless noted.
const INFO_LINE = '[info] aqz-KE-bpKQ: Downloading 1 format(s): 160+139'
const DESTINATION_LINE = '[download] Destination: test.f160.mp4'
const MERGER_LINE = '[Merger] Merging formats into "test.mp4"'

const FIRST_TICK =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 4323893, "tmpfilename": "test.f160.mp4.part", "filename": "test.f160.mp4", "eta": null, "speed": null, "elapsed": 0.055, "ctx_id": null, "_eta_str": "Unknown", "_speed_str": " Unknown B/s", "_percent": 0.0236, "_percent_str": "  0.0%", "_total_bytes_str": "   4.12MiB", "_total_bytes_estimate_str": "       N/A", "_downloaded_bytes_str": "   1.00KiB", "_elapsed_str": "00:00:00", "_default_template": "  0.0% of    4.12MiB at  Unknown B/s ETA Unknown"}'
const MID_TICK =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 2096128, "total_bytes": 4323893, "tmpfilename": "test.f160.mp4.part", "filename": "test.f160.mp4", "eta": 0, "speed": 42971715.11, "elapsed": 0.104, "ctx_id": null, "_eta_str": "00:00", "_speed_str": "  40.98MiB/s", "_percent": 48.4777, "_percent_str": " 48.5%", "_total_bytes_str": "   4.12MiB", "_total_bytes_estimate_str": "       N/A", "_downloaded_bytes_str": "   2.00MiB", "_elapsed_str": "00:00:00", "_default_template": " 48.5% of    4.12MiB at   40.98MiB/s ETA 00:00"}'
const FINISHED_TICK =
  'LILNAS_PROGRESS {"downloaded_bytes": 4323893, "total_bytes": 4323893, "filename": "test.f160.mp4", "status": "finished", "elapsed": 0.193, "ctx_id": null, "speed": 22382070.50, "_speed_str": "21.35MiB/s", "_total_bytes_str": "   4.12MiB", "_elapsed_str": "00:00:00", "_percent": 100.0, "_percent_str": "100.0%", "_default_template": "100% of    4.12MiB in 00:00:00 at 21.35MiB/s"}'

// The second file's lines, completed from the abbreviated real output.
const SECOND_DESTINATION_LINE = '[download] Destination: test.f139.m4a'
const SECOND_FIRST_TICK =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 3871021, "tmpfilename": "test.f139.m4a.part", "filename": "test.f139.m4a", "eta": null, "speed": null, "elapsed": 0.012, "ctx_id": null, "_eta_str": "Unknown", "_speed_str": " Unknown B/s", "_percent": 0.0265, "_percent_str": "  0.0%", "_total_bytes_str": "   3.69MiB", "_total_bytes_estimate_str": "       N/A", "_downloaded_bytes_str": "   1.00KiB", "_elapsed_str": "00:00:00", "_default_template": "  0.0% of    3.69MiB at  Unknown B/s ETA Unknown"}'
const SECOND_MID_TICK =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 2096128, "total_bytes": 3871021, "tmpfilename": "test.f139.m4a.part", "filename": "test.f139.m4a", "eta": 0.04, "speed": 45112233.5, "elapsed": 0.058, "ctx_id": null, "_eta_str": "00:00", "_speed_str": "  43.02MiB/s", "_percent": 54.1492, "_percent_str": " 54.1%", "_total_bytes_str": "   3.69MiB", "_total_bytes_estimate_str": "       N/A", "_downloaded_bytes_str": "   2.00MiB", "_elapsed_str": "00:00:00", "_default_template": " 54.1% of    3.69MiB at   43.02MiB/s ETA 00:00"}'
const SECOND_FINISHED_TICK =
  'LILNAS_PROGRESS {"downloaded_bytes": 3871021, "total_bytes": 3871021, "filename": "test.f139.m4a", "status": "finished", "elapsed": 0.101, "ctx_id": null, "speed": 38326940.59, "_speed_str": "36.55MiB/s", "_total_bytes_str": "   3.69MiB", "_elapsed_str": "00:00:00", "_percent": 100.0, "_percent_str": "100.0%", "_default_template": "100% of    3.69MiB in 00:00:00 at 36.55MiB/s"}'

const HLS_FRAGMENT_0_TICK =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 712, "fragment_index": 0, "fragment_count": 123, "filename": "b.mp4", "tmpfilename": "b.mp4.part", "max_progress": null, "progress_idx": null, "elapsed": 0, "total_bytes_estimate": 712, "speed": 2710.76, "eta": null, "_eta_str": "Unknown", "_speed_str": "   2.65KiB/s", "_percent": 100.0, "_percent_str": "100.0%", "_total_bytes_str": "       N/A", "_total_bytes_estimate_str": "   712.00B", "_downloaded_bytes_str": "   712.00B", "_elapsed_str": "00:00:00", "_default_template": "100.0% of ~   712.00B at    2.65KiB/s ETA Unknown (frag 0/123)"}'
const HLS_FRAGMENT_4_TICK =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 27851094, "fragment_index": 4, "fragment_count": 123, "filename": "b.mp4", "tmpfilename": "b.mp4.part", "max_progress": null, "progress_idx": null, "elapsed": 0.806, "total_bytes_estimate": 685111722.0, "speed": 18432231.02, "eta": 31.97, "_eta_str": "00:31", "_percent": 4.0652, "_default_template": "  4.1% of ~ 653.37MiB at   17.58MiB/s ETA 00:31 (frag 4/123)"}'

const tick = (fields: Record<string, unknown>) =>
  `${YTDLP_PROGRESS_PREFIX}${JSON.stringify(fields)}`

describe('YTDLP_PROGRESS_ARGS', () => {
  it('asks for one JSON tick per line behind the prefix', () => {
    expect(YTDLP_PROGRESS_ARGS).toEqual([
      '--newline',
      '--progress-delta',
      '1',
      '--progress-template',
      'download:LILNAS_PROGRESS %(progress)j',
    ])
  })
})

describe('parseYtdlpProgressLine', () => {
  it('reads the first progressive tick with null speed and eta as absent keys', () => {
    const parsed = parseYtdlpProgressLine(FIRST_TICK)

    expect(parsed).toEqual({
      downloadedBytes: 1024,
      filename: 'test.f160.mp4',
      status: 'downloading',
      totalBytes: 4323893,
    })
    expect(parsed).not.toHaveProperty('speedBps')
    expect(parsed).not.toHaveProperty('etaSeconds')
    expect(parsed).not.toHaveProperty('totalIsEstimate')
  })

  it('reads a mid tick with speed and eta', () => {
    expect(parseYtdlpProgressLine(MID_TICK)).toEqual({
      downloadedBytes: 2096128,
      etaSeconds: 0,
      filename: 'test.f160.mp4',
      speedBps: 42971715.11,
      status: 'downloading',
      totalBytes: 4323893,
    })
  })

  it('reads a finished tick, which carries no eta or tmpfilename', () => {
    expect(parseYtdlpProgressLine(FINISHED_TICK)).toEqual({
      downloadedBytes: 4323893,
      filename: 'test.f160.mp4',
      speedBps: 22382070.5,
      status: 'finished',
      totalBytes: 4323893,
    })
  })

  it('reads an HLS tick: estimate total, fragments, float eta', () => {
    expect(parseYtdlpProgressLine(HLS_FRAGMENT_4_TICK)).toEqual({
      downloadedBytes: 27851094,
      etaSeconds: 31.97,
      filename: 'b.mp4',
      fragmentCount: 123,
      fragmentIndex: 4,
      speedBps: 18432231.02,
      status: 'downloading',
      totalBytes: 685111722,
      totalIsEstimate: true,
    })
  })

  it('prefers total_bytes over total_bytes_estimate', () => {
    const parsed = parseYtdlpProgressLine(
      tick({
        downloaded_bytes: 10,
        filename: 'a',
        status: 'downloading',
        total_bytes: 100,
        total_bytes_estimate: 200,
      }),
    )

    expect(parsed?.totalBytes).toBe(100)
    expect(parsed).not.toHaveProperty('totalIsEstimate')
  })

  it('rounds float byte counts to integers', () => {
    expect(
      parseYtdlpProgressLine(
        tick({
          downloaded_bytes: 1000.6,
          filename: 'a',
          status: 'downloading',
          total_bytes_estimate: 5000.4,
        }),
      ),
    ).toEqual({
      downloadedBytes: 1001,
      filename: 'a',
      status: 'downloading',
      totalBytes: 5000,
      totalIsEstimate: true,
    })
  })

  it.each([
    ['no total at all', {}],
    ['a zero total', { total_bytes: 0 }],
    ['a negative estimate', { total_bytes_estimate: -5 }],
    ['a null total', { total_bytes: null, total_bytes_estimate: null }],
  ])('leaves totalBytes and totalIsEstimate absent for %s', (_, extra) => {
    const parsed = parseYtdlpProgressLine(
      tick({
        downloaded_bytes: 1,
        filename: 'a',
        status: 'downloading',
        ...extra,
      }),
    )

    expect(parsed).toEqual({
      downloadedBytes: 1,
      filename: 'a',
      status: 'downloading',
    })
  })

  it('drops non-finite and negative speed/eta', () => {
    // JSON cannot carry Infinity, but 1e999 parses to it.
    const parsed = parseYtdlpProgressLine(
      `${YTDLP_PROGRESS_PREFIX}{"status": "downloading", "downloaded_bytes": 1, "filename": "a", "speed": 1e999, "eta": -3}`,
    )

    expect(parsed).toEqual({
      downloadedBytes: 1,
      filename: 'a',
      status: 'downloading',
    })
  })

  it('drops fragments unless both are finite integers', () => {
    const base = { downloaded_bytes: 1, filename: 'a', status: 'downloading' }

    for (const extra of [
      { fragment_index: 1 },
      { fragment_index: 1, fragment_count: null },
      { fragment_index: 1.5, fragment_count: 10 },
      { fragment_index: 1, fragment_count: 0 },
      { fragment_index: '1', fragment_count: 10 },
    ]) {
      const parsed = parseYtdlpProgressLine(tick({ ...base, ...extra }))
      expect(parsed).not.toHaveProperty('fragmentIndex')
      expect(parsed).not.toHaveProperty('fragmentCount')
    }
  })

  it.each([
    ['a destination line', DESTINATION_LINE],
    ['the info line', INFO_LINE],
    ['the merger line', MERGER_LINE],
    ['an empty line', ''],
    ['the prefix alone', YTDLP_PROGRESS_PREFIX],
    ['truncated JSON', FIRST_TICK.slice(0, 80)],
    ['JSON that is not an object', `${YTDLP_PROGRESS_PREFIX}[1, 2]`],
    ['JSON null', `${YTDLP_PROGRESS_PREFIX}null`],
    ['the prefix mid-line', `  ${FIRST_TICK}`],
    ['a missing status', tick({ downloaded_bytes: 1, filename: 'a' })],
    [
      'an unknown status',
      tick({ downloaded_bytes: 1, filename: 'a', status: 'error' }),
    ],
    [
      'a missing filename',
      tick({ downloaded_bytes: 1, status: 'downloading' }),
    ],
    [
      'a numeric filename',
      tick({ downloaded_bytes: 1, filename: 7, status: 'downloading' }),
    ],
    [
      'a missing downloaded_bytes',
      tick({ filename: 'a', status: 'downloading' }),
    ],
    [
      'a string downloaded_bytes',
      tick({ downloaded_bytes: '1', filename: 'a', status: 'downloading' }),
    ],
    [
      'a negative downloaded_bytes',
      tick({ downloaded_bytes: -1, filename: 'a', status: 'downloading' }),
    ],
  ])('returns undefined for %s', (_, line) => {
    expect(parseYtdlpProgressLine(line)).toBeUndefined()
  })

  it('never throws, even on non-string input', () => {
    expect(() =>
      parseYtdlpProgressLine(undefined as unknown as string),
    ).not.toThrow()
    expect(parseYtdlpProgressLine(undefined as unknown as string)).toBe(
      undefined,
    )
  })
})

describe('parseYtdlpFormatCountLine', () => {
  it('counts a merged format list', () => {
    expect(parseYtdlpFormatCountLine(INFO_LINE)).toBe(2)
  })

  it('counts a single format', () => {
    expect(
      parseYtdlpFormatCountLine(
        '[info] aqz-KE-bpKQ: Downloading 1 format(s): 22',
      ),
    ).toBe(1)
  })

  it.each([
    ['a destination line', DESTINATION_LINE],
    ['a progress tick', FIRST_TICK],
    ['the merger line', MERGER_LINE],
    ['an unrelated info line', '[info] aqz-KE-bpKQ: Downloading webpage'],
    ['an empty format list', '[info] abc: Downloading 1 format(s): '],
    ['an empty line', ''],
  ])('returns undefined for %s', (_, line) => {
    expect(parseYtdlpFormatCountLine(line)).toBeUndefined()
  })
})

describe('createProgressReducer', () => {
  it('folds the two-file merge grab into snapshots', () => {
    const reducer = createProgressReducer()
    const lines = [
      INFO_LINE,
      DESTINATION_LINE,
      FIRST_TICK,
      MID_TICK,
      FINISHED_TICK,
      SECOND_DESTINATION_LINE,
      SECOND_FIRST_TICK,
      SECOND_MID_TICK,
      SECOND_FINISHED_TICK,
      MERGER_LINE,
    ]
    const results = lines.map(line => reducer.next(line))

    // Non-tick lines (info, destination, merger) produce nothing.
    expect(results[0]).toBeUndefined()
    expect(results[1]).toBeUndefined()
    expect(results[5]).toBeUndefined()
    expect(results[9]).toBeUndefined()

    expect(results[2]).toEqual({
      flush: true,
      snapshot: {
        downloadedBytes: 1024,
        fileCount: 2,
        fileIndex: 1,
        percent: 0.02,
        totalBytes: 4323893,
      },
    })
    expect(results[3]).toEqual({
      flush: false,
      snapshot: {
        downloadedBytes: 2096128,
        etaSeconds: 0,
        fileCount: 2,
        fileIndex: 1,
        percent: 48.48,
        speedBps: 42971715.11,
        totalBytes: 4323893,
      },
    })
    // First file done, but a second file follows - no flush.
    expect(results[4]).toEqual({
      flush: false,
      snapshot: {
        downloadedBytes: 4323893,
        fileCount: 2,
        fileIndex: 1,
        percent: 100,
        speedBps: 22382070.5,
        totalBytes: 4323893,
      },
    })
    expect(results[6]).toEqual({
      flush: true,
      snapshot: {
        downloadedBytes: 1024,
        fileCount: 2,
        fileIndex: 2,
        percent: 0.03,
        totalBytes: 3871021,
      },
    })
    expect(results[7]?.flush).toBe(false)
    expect(results[7]?.snapshot.fileIndex).toBe(2)
    expect(results[8]).toEqual({
      flush: true,
      snapshot: {
        downloadedBytes: 3871021,
        fileCount: 2,
        fileIndex: 2,
        percent: 100,
        speedBps: 38326940.59,
        totalBytes: 3871021,
      },
    })

    // Every snapshot is valid on the wire.
    for (const result of results) {
      if (result)
        expect(VideoProgressSchema.parse(result.snapshot)).toEqual(
          result.snapshot,
        )
    }
  })

  it('clamps the HLS fragment-0 tick from bytes, not yt-dlp _percent', () => {
    const reducer = createProgressReducer()

    const first = reducer.next(HLS_FRAGMENT_0_TICK)
    // 712 / 712 clamps to 100 - yt-dlp's own `_percent` is never read.
    expect(first).toEqual({
      flush: true,
      snapshot: {
        downloadedBytes: 712,
        fileIndex: 1,
        fragmentCount: 123,
        fragmentIndex: 0,
        percent: 100,
        speedBps: 2710.76,
        totalBytes: 712,
        totalIsEstimate: true,
      },
    })

    const next = reducer.next(HLS_FRAGMENT_4_TICK)
    expect(next).toEqual({
      flush: false,
      snapshot: {
        downloadedBytes: 27851094,
        etaSeconds: 31.97,
        fileIndex: 1,
        fragmentCount: 123,
        fragmentIndex: 4,
        percent: 4.07,
        speedBps: 18432231.02,
        totalBytes: 685111722,
        totalIsEstimate: true,
      },
    })
    expect(VideoProgressSchema.safeParse(next?.snapshot).success).toBe(true)
  })

  it('clamps percent at 100 when the estimate trails the bytes', () => {
    const reducer = createProgressReducer()
    const result = reducer.next(
      tick({
        downloaded_bytes: 900,
        filename: 'b.mp4',
        status: 'downloading',
        total_bytes_estimate: 800,
      }),
    )

    expect(result?.snapshot.percent).toBe(100)
  })

  it('flushes a finished tick when fileCount was never seen', () => {
    const reducer = createProgressReducer()
    reducer.next(FIRST_TICK)
    reducer.next(MID_TICK)
    const finished = reducer.next(FINISHED_TICK)

    expect(finished?.flush).toBe(true)
    expect(finished?.snapshot).not.toHaveProperty('fileCount')
  })

  it('leaves percent absent and bytes as reported for a finished tick with no total', () => {
    const reducer = createProgressReducer()
    const result = reducer.next(
      tick({ downloaded_bytes: 42, filename: 'a', status: 'finished' }),
    )

    expect(result).toEqual({
      flush: true,
      snapshot: { downloadedBytes: 42, fileIndex: 1 },
    })
  })

  it('applies a format-count line to later snapshots only', () => {
    const reducer = createProgressReducer()
    const before = reducer.next(FIRST_TICK)
    expect(reducer.next(INFO_LINE)).toBeUndefined()
    const after = reducer.next(MID_TICK)

    expect(before?.snapshot).not.toHaveProperty('fileCount')
    expect(after?.snapshot.fileCount).toBe(2)
  })

  it('ignores malformed lines without disturbing state', () => {
    const reducer = createProgressReducer()
    reducer.next(FIRST_TICK)
    expect(reducer.next(FIRST_TICK.slice(0, 60))).toBeUndefined()
    expect(reducer.next(`${YTDLP_PROGRESS_PREFIX}{}`)).toBeUndefined()

    const result = reducer.next(MID_TICK)
    expect(result?.flush).toBe(false)
    expect(result?.snapshot.fileIndex).toBe(1)
  })
})

describe('createLineSplitter', () => {
  const collect = () => {
    const lines: string[] = []
    const splitter = createLineSplitter(line => lines.push(line))
    return { lines, splitter }
  }

  it('joins a line split mid-way across chunks', () => {
    const { lines, splitter } = collect()
    splitter.push(FIRST_TICK.slice(0, 50))
    expect(lines).toEqual([])
    splitter.push(Buffer.from(`${FIRST_TICK.slice(50)}\n${DESTINATION_LINE}`))
    expect(lines).toEqual([FIRST_TICK])
    splitter.push('\n')
    expect(lines).toEqual([FIRST_TICK, DESTINATION_LINE])
  })

  it('splits on \\r\\n, including a pair split across chunks', () => {
    const { lines, splitter } = collect()
    splitter.push('one\r\ntwo\r')
    splitter.push('\nthree\r\n')

    expect(lines).toEqual(['one', 'two', 'three'])
  })

  it('does nothing for an empty chunk', () => {
    const { lines, splitter } = collect()
    splitter.push('')
    splitter.push(Buffer.alloc(0))
    splitter.flush()

    expect(lines).toEqual([])
  })

  it('never emits empty lines', () => {
    const { lines, splitter } = collect()
    splitter.push('\n\na\n\n\r\nb\n')

    expect(lines).toEqual(['a', 'b'])
  })

  it('emits the unterminated tail on flush', () => {
    const { lines, splitter } = collect()
    splitter.push(`${INFO_LINE}\n${MERGER_LINE}`)
    expect(lines).toEqual([INFO_LINE])

    splitter.flush()
    expect(lines).toEqual([INFO_LINE, MERGER_LINE])

    splitter.flush()
    expect(lines).toEqual([INFO_LINE, MERGER_LINE])
  })

  it('keeps a multi-byte character split across Buffer chunks intact', () => {
    const { lines, splitter } = collect()
    const bytes = Buffer.from('café\n')
    splitter.push(bytes.subarray(0, 4))
    splitter.push(bytes.subarray(4))

    expect(lines).toEqual(['café'])
  })

  it('drops an over-long line without a newline instead of growing forever', () => {
    const { lines, splitter } = collect()
    const junk = 'x'.repeat(40 * 1024)
    splitter.push(junk)
    splitter.push(junk)
    splitter.push(junk)
    splitter.push(`tail-of-junk\n${DESTINATION_LINE}\n`)
    splitter.flush()

    expect(lines).toEqual([DESTINATION_LINE])
  })
})
