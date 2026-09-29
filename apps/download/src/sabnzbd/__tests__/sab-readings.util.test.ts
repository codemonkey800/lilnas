import {
  SAB_DISK_FULL_FAIL_MESSAGE,
  SAB_EPISODE_NZO_ID,
  SAB_MANUAL_NZO_ID,
  SAB_MOVIE_NZO_ID,
} from 'src/sabnzbd/__tests__/fixtures/sabnzbd.fixtures'
import {
  reduceSabReads,
  SAB_GONE_GRACE_TICKS,
  type SabHistoryRead,
  type SabHistorySlotRead,
  type SabPhase,
  type SabQueueRead,
  type SabQueueSlotRead,
  type SabReading,
  type SabReadResult,
} from 'src/sabnzbd/sab-readings.util'

const MIB = 1024 * 1024
const NOW = 1_790_572_800_000

// - Builders for already-parsed reads; the ids come from the committed
//   SAB 5.1.3 fixtures so the story matches the other SAB specs.

function slot(overrides: Partial<SabQueueSlotRead> = {}): SabQueueSlotRead {
  return {
    nzo_id: SAB_MOVIE_NZO_ID,
    index: 0,
    status: 'Downloading',
    priority: 'Normal',
    mb: 1000,
    mbleft: 400,
    timeleft: 600,
    ...overrides,
  }
}

function queueRead(
  slots: SabQueueSlotRead[],
  overrides: Partial<Omit<SabQueueRead, 'slots'>> = {},
): SabQueueRead {
  return { paused: false, diskspace1: 1843.21, slots, ...overrides }
}

function historyRow(
  status: string,
  overrides: Partial<SabHistorySlotRead> = {},
): SabHistorySlotRead {
  return {
    nzo_id: SAB_MOVIE_NZO_ID,
    status,
    action_line: '',
    fail_message: '',
    ...overrides,
  }
}

function historyRead(slots: SabHistorySlotRead[]): SabHistoryRead {
  return { slots }
}

interface State {
  readings: ReadonlyMap<string, SabReading>
  missingTicks: ReadonlyMap<string, number>
}

const EMPTY: State = { readings: new Map(), missingTicks: new Map() }

/** One tick against `state`; the result is itself the next state. */
function tick(
  state: State,
  input: {
    queue?: SabQueueRead
    history?: SabHistoryRead | null
    now?: number
  } = {},
): SabReadResult {
  return reduceSabReads(state.readings, {
    queue: input.queue ?? queueRead([]),
    history: input.history ?? null,
    now: input.now ?? NOW,
    missingTicks: state.missingTicks,
  })
}

function phaseOf(result: SabReadResult, nzoId: string): SabPhase | undefined {
  return result.readings.get(nzoId)?.phase
}

describe('reduceSabReads - queue phases', () => {
  it.each<[string, Partial<SabQueueSlotRead>, boolean, SabPhase]>([
    ['a slot paused on its own', { status: 'Paused' }, false, 'paused'],
    ['Queued', { status: 'Queued' }, false, 'queued'],
    ['Grabbing', { status: 'Grabbing' }, false, 'queued'],
    ['Propagating', { status: 'Propagating' }, false, 'queued'],
    ['Checking', { status: 'Checking' }, false, 'queued'],
    ['Downloading', { status: 'Downloading' }, false, 'downloading'],
    ['Fetching (extra par2)', { status: 'Fetching' }, false, 'downloading'],
    ['an unknown status', { status: 'Mystery' }, false, 'queued'],
    ['Queued under a global pause', { status: 'Queued' }, true, 'paused'],
    [
      'Downloading under a global pause',
      { status: 'Downloading' },
      true,
      'paused',
    ],
    [
      'a Force slot under a global pause',
      { status: 'Downloading', priority: 'Force' },
      true,
      'downloading',
    ],
    [
      'a Force slot (int form) under a global pause',
      { status: 'Downloading', priority: 2 },
      true,
      'downloading',
    ],
    [
      'a Force slot paused on its own',
      { status: 'Paused', priority: 'Force' },
      false,
      'paused',
    ],
  ])('%s', (_label, overrides, paused, expected) => {
    const result = tick(EMPTY, {
      queue: queueRead([slot(overrides)], { paused }),
    })

    expect(phaseOf(result, SAB_MOVIE_NZO_ID)).toBe(expected)
  })

  it('only the first Downloading slot by index is downloading', () => {
    // - Array order deliberately differs from queue order.
    const result = tick(EMPTY, {
      queue: queueRead([
        slot({ nzo_id: SAB_MOVIE_NZO_ID, index: 1 }),
        slot({ nzo_id: SAB_MANUAL_NZO_ID, index: 2 }),
        slot({ nzo_id: SAB_EPISODE_NZO_ID, index: 0 }),
      ]),
    })

    expect(phaseOf(result, SAB_EPISODE_NZO_ID)).toBe('downloading')
    expect(phaseOf(result, SAB_MOVIE_NZO_ID)).toBe('queued')
    expect(phaseOf(result, SAB_MANUAL_NZO_ID)).toBe('queued')
  })

  it('skips paused slots when picking the downloading one', () => {
    const result = tick(EMPTY, {
      queue: queueRead([
        slot({ nzo_id: SAB_EPISODE_NZO_ID, index: 0, status: 'Paused' }),
        slot({ nzo_id: SAB_MOVIE_NZO_ID, index: 1, status: 'Fetching' }),
        slot({ nzo_id: SAB_MANUAL_NZO_ID, index: 2 }),
      ]),
    })

    expect(phaseOf(result, SAB_EPISODE_NZO_ID)).toBe('paused')
    expect(phaseOf(result, SAB_MOVIE_NZO_ID)).toBe('downloading')
    expect(phaseOf(result, SAB_MANUAL_NZO_ID)).toBe('queued')
  })

  it('keeps a Force slot downloading through a global pause', () => {
    const result = tick(EMPTY, {
      queue: queueRead(
        [
          slot({ nzo_id: SAB_EPISODE_NZO_ID, index: 0, status: 'Queued' }),
          slot({ nzo_id: SAB_MOVIE_NZO_ID, index: 1, priority: 'Force' }),
        ],
        { paused: true, diskspace1: 0.42 },
      ),
    })

    expect(result.readings.get(SAB_EPISODE_NZO_ID)).toMatchObject({
      phase: 'paused',
      etaSeconds: null,
      globallyPaused: true,
      diskFreeGb: 0.42,
    })
    expect(result.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      phase: 'downloading',
      etaSeconds: 600,
      globallyPaused: true,
      diskFreeGb: 0.42,
    })
  })

  it('skips Deleted slots as if they were absent', () => {
    const first = tick(EMPTY, {
      queue: queueRead([slot({ nzo_id: SAB_EPISODE_NZO_ID })]),
    })
    const second = tick(first, {
      queue: queueRead([
        slot({ nzo_id: SAB_EPISODE_NZO_ID, status: 'Deleted' }),
        slot({ nzo_id: SAB_MANUAL_NZO_ID, index: 1, status: 'Deleted' }),
      ]),
    })

    expect(second.readings.has(SAB_MANUAL_NZO_ID)).toBe(false)
    expect(second.missingTicks.get(SAB_EPISODE_NZO_ID)).toBe(1)
    expect(second.transitions).toEqual([])
  })
})

describe('reduceSabReads - numbers', () => {
  it('reads mb / mbleft as MiB', () => {
    const result = tick(EMPTY, {
      queue: queueRead([slot({ mb: 1024.5, mbleft: 24.25 })]),
    })

    expect(result.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      totalBytes: 1024.5 * MIB,
      downloadedBytes: 1000.25 * MIB,
    })
  })

  it.each<[string, Partial<SabQueueSlotRead>, boolean, number | null]>([
    ['downloading', { status: 'Downloading' }, false, 600],
    [
      'queued (cumulative, as SAB reports it)',
      { status: 'Queued' },
      false,
      600,
    ],
    ['paused on its own', { status: 'Paused' }, false, null],
    ['globally paused', { status: 'Queued' }, true, null],
    ['unknown', { timeleft: null }, false, null],
  ])('etaSeconds when %s', (_label, overrides, paused, expected) => {
    const result = tick(EMPTY, {
      queue: queueRead([slot(overrides)], { paused }),
    })

    expect(result.readings.get(SAB_MOVIE_NZO_ID)?.etaSeconds).toBe(expected)
  })
})

describe('reduceSabReads - history phases', () => {
  it.each<[string, SabPhase]>([
    ['Queued', 'post_processing'],
    ['QuickCheck', 'post_processing'],
    ['Verifying', 'post_processing'],
    ['Repairing', 'post_processing'],
    ['Extracting', 'post_processing'],
    ['Moving', 'post_processing'],
    ['Running', 'post_processing'],
    ['Completed', 'completed'],
    ['Failed', 'failed'],
  ])('history %s -> %s', (status, expected) => {
    const result = tick(EMPTY, { history: historyRead([historyRow(status)]) })

    expect(result.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      phase: expected,
      stage: expected === 'post_processing' ? status : null,
      etaSeconds: null,
      speedBps: null,
    })
  })

  it('carries the fail message of a failed job', () => {
    const result = tick(EMPTY, {
      history: historyRead([
        historyRow('Failed', {
          nzo_id: SAB_EPISODE_NZO_ID,
          fail_message: SAB_DISK_FULL_FAIL_MESSAGE,
        }),
      ]),
    })

    expect(result.readings.get(SAB_EPISODE_NZO_ID)?.failMessage).toBe(
      SAB_DISK_FULL_FAIL_MESSAGE,
    )
  })

  it.each<[string, string | null, string | null]>([
    [
      'SAB double space collapsed',
      'Repairing: 45%  - 1:23 left',
      'Repairing: 45% - 1:23 left',
    ],
    [
      'inline tags removed, <br> as a space',
      '<b>Unpacking</b>: 01/10<br/>12 sec left',
      'Unpacking: 01/10 12 sec left',
    ],
    ['empty', '', null],
    ['only tags', '<br />', null],
    ['null', null, null],
  ])('stageDetail: %s', (_label, actionLine, expected) => {
    const result = tick(EMPTY, {
      history: historyRead([
        historyRow('Repairing', { action_line: actionLine }),
      ]),
    })

    expect(result.readings.get(SAB_MOVIE_NZO_ID)?.stageDetail).toBe(expected)
  })

  it('prefers the queue when an id is in both views', () => {
    const result = tick(EMPTY, {
      queue: queueRead([slot()]),
      history: historyRead([historyRow('Failed')]),
    })

    expect(phaseOf(result, SAB_MOVIE_NZO_ID)).toBe('downloading')
    expect(result.transitions).toEqual([
      { nzoId: SAB_MOVIE_NZO_ID, from: null, to: 'downloading' },
    ])
  })

  it('keeps the last queue total, fully downloaded, once post-processing', () => {
    const downloading = tick(EMPTY, {
      queue: queueRead([slot({ mb: 1000, mbleft: 0.5 })]),
    })
    const repairing = tick(downloading, {
      history: historyRead([historyRow('Repairing')]),
    })

    expect(repairing.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      totalBytes: 1000 * MIB,
      downloadedBytes: 1000 * MIB,
    })
  })

  it('keeps the last downloaded count when a download fails', () => {
    const downloading = tick(EMPTY, {
      queue: queueRead([slot({ mb: 1000, mbleft: 400 })]),
    })
    const failed = tick(downloading, {
      history: historyRead([historyRow('Failed')]),
    })

    expect(failed.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      totalBytes: 1000 * MIB,
      downloadedBytes: 600 * MIB,
    })
  })

  it('has zero bytes for an id never seen in the queue', () => {
    const result = tick(EMPTY, {
      history: historyRead([historyRow('Completed')]),
    })

    expect(result.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      totalBytes: 0,
      downloadedBytes: 0,
    })
  })
})

describe('reduceSabReads - missing ids', () => {
  const downloading = tick(EMPTY, { queue: queueRead([slot()]) })

  it(`survives ${SAB_GONE_GRACE_TICKS} missing ticks, then is gone`, () => {
    const empty = { history: historyRead([]) }
    const miss1 = tick(downloading, { ...empty, now: NOW + 1000 })
    const miss2 = tick(miss1, { ...empty, now: NOW + 2000 })
    const miss3 = tick(miss2, { ...empty, now: NOW + 3000 })

    expect(miss1.readings.get(SAB_MOVIE_NZO_ID)).toBe(
      downloading.readings.get(SAB_MOVIE_NZO_ID),
    )
    expect(miss1.missingTicks.get(SAB_MOVIE_NZO_ID)).toBe(1)
    expect(miss1.transitions).toEqual([])

    expect(phaseOf(miss2, SAB_MOVIE_NZO_ID)).toBe('downloading')
    expect(miss2.missingTicks.get(SAB_MOVIE_NZO_ID)).toBe(2)
    expect(miss2.transitions).toEqual([])

    expect(miss3.readings.get(SAB_MOVIE_NZO_ID)).toMatchObject({
      phase: 'gone',
      seenAt: NOW,
      speedBps: null,
      etaSeconds: null,
    })
    expect(miss3.missingTicks.has(SAB_MOVIE_NZO_ID)).toBe(false)
    expect(miss3.transitions).toEqual([
      { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'gone' },
    ])
  })

  it('bridges the download -> post-processing handoff gap', () => {
    const miss1 = tick(downloading, { history: historyRead([]) })
    const miss2 = tick(miss1, { history: historyRead([]) })
    const repairing = tick(miss2, {
      history: historyRead([historyRow('Repairing')]),
      now: NOW + 3000,
    })

    expect(repairing.transitions).toEqual([
      { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'post_processing' },
    ])
    expect(repairing.missingTicks.has(SAB_MOVIE_NZO_ID)).toBe(false)
    expect(repairing.readings.get(SAB_MOVIE_NZO_ID)?.seenAt).toBe(NOW + 3000)
  })

  it('resets the count when an id is seen again', () => {
    const miss1 = tick(downloading, { history: historyRead([]) })
    const back = tick(miss1, { queue: queueRead([slot()]) })
    const missAgain = tick(back, { history: historyRead([]) })

    expect(back.missingTicks.has(SAB_MOVIE_NZO_ID)).toBe(false)
    expect(back.transitions).toEqual([])
    expect(missAgain.missingTicks.get(SAB_MOVIE_NZO_ID)).toBe(1)
  })

  it('counts a miss for an id that left the queue while history is null', () => {
    const miss1 = tick(downloading, { history: null })

    expect(miss1.missingTicks.get(SAB_MOVIE_NZO_ID)).toBe(1)
  })

  it('drops a gone reading the next tick it is still absent', () => {
    let state: SabReadResult = downloading
    for (let i = 0; i <= SAB_GONE_GRACE_TICKS; i++) {
      state = tick(state, { history: historyRead([]) })
    }
    const after = tick(state, { history: historyRead([]) })

    expect(phaseOf(state, SAB_MOVIE_NZO_ID)).toBe('gone')
    expect(after.readings.has(SAB_MOVIE_NZO_ID)).toBe(false)
    expect(after.transitions).toEqual([])
  })
})

describe('reduceSabReads - history not fetched', () => {
  it.each<[string]>([['Repairing'], ['Completed'], ['Failed']])(
    'keeps a %s reading without counting a miss',
    status => {
      const fromHistory = tick(EMPTY, {
        history: historyRead([historyRow(status)]),
      })
      const next = tick(fromHistory, { history: null, now: NOW + 1000 })

      expect(next.readings.get(SAB_MOVIE_NZO_ID)).toBe(
        fromHistory.readings.get(SAB_MOVIE_NZO_ID),
      )
      expect(next.missingTicks.has(SAB_MOVIE_NZO_ID)).toBe(false)
      expect(next.transitions).toEqual([])
    },
  )

  it('counts a miss once a fetched history no longer lists it', () => {
    const repairing = tick(EMPTY, {
      history: historyRead([historyRow('Repairing')]),
    })
    const unchanged = tick(repairing, { history: null })
    const refetched = tick(unchanged, { history: historyRead([]) })

    expect(refetched.missingTicks.get(SAB_MOVIE_NZO_ID)).toBe(1)
    expect(phaseOf(refetched, SAB_MOVIE_NZO_ID)).toBe('post_processing')
  })
})

describe('reduceSabReads - terminal readings', () => {
  const completed = tick(EMPTY, {
    history: historyRead([historyRow('Completed')]),
  })

  it('stays while history still lists it, without a new transition', () => {
    const next = tick(completed, {
      history: historyRead([historyRow('Completed')]),
      now: NOW + 1000,
    })

    expect(next.readings.get(SAB_MOVIE_NZO_ID)?.seenAt).toBe(NOW + 1000)
    expect(next.transitions).toEqual([])
  })

  it('is dropped, without a transition, once history no longer lists it', () => {
    const next = tick(completed, { history: historyRead([]) })

    expect(next.readings.has(SAB_MOVIE_NZO_ID)).toBe(false)
    expect(next.missingTicks.has(SAB_MOVIE_NZO_ID)).toBe(false)
    expect(next.transitions).toEqual([])
  })

  it('reports a retried job that reappears in the queue', () => {
    const failed = tick(EMPTY, {
      history: historyRead([historyRow('Failed')]),
    })
    const retried = tick(failed, {
      queue: queueRead([slot({ status: 'Queued' })], { paused: false }),
    })

    expect(retried.transitions).toEqual([
      { nzoId: SAB_MOVIE_NZO_ID, from: 'failed', to: 'queued' },
    ])
  })
})

describe('reduceSabReads - speed', () => {
  const at = (seconds: number, mbleft: number, status = 'Downloading') => ({
    queue: queueRead([slot({ mb: 1000, mbleft, status })]),
    now: NOW + seconds * 1000,
  })

  it('is null until two samples, then an EWMA with alpha 0.3', () => {
    const s1 = tick(EMPTY, at(0, 1000))
    const s2 = tick(s1, at(1, 990))
    const s3 = tick(s2, at(2, 970))

    expect(s1.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBeNull()
    expect(s2.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBe(10 * MIB)
    // - 0.3 * 20 MiB/s + 0.7 * 10 MiB/s
    expect(s3.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBeCloseTo(13 * MIB)
  })

  it('resets on a phase change', () => {
    const s1 = tick(EMPTY, at(0, 1000))
    const s2 = tick(s1, at(1, 990))
    const paused = tick(s2, at(2, 990, 'Paused'))
    const resumed = tick(paused, at(3, 990))
    const s5 = tick(resumed, at(4, 985))

    expect(paused.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBeNull()
    expect(resumed.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBeNull()
    expect(s5.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBe(5 * MIB)
  })

  it('keeps the last speed when mbleft rises (extra par2)', () => {
    const s1 = tick(EMPTY, at(0, 1000))
    const s2 = tick(s1, at(1, 990))
    const fetching = tick(s2, {
      queue: queueRead([slot({ mb: 1000, mbleft: 995, status: 'Fetching' })]),
      now: NOW + 2000,
    })
    const s4 = tick(fetching, {
      queue: queueRead([slot({ mb: 1000, mbleft: 975, status: 'Fetching' })]),
      now: NOW + 3000,
    })

    expect(fetching.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBe(10 * MIB)
    // - Next sample measures from the new baseline: 20 MiB in 1 s.
    expect(s4.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBeCloseTo(13 * MIB)
  })

  it('keeps the last speed when no time has passed', () => {
    const s1 = tick(EMPTY, at(0, 1000))
    const s2 = tick(s1, at(1, 990))
    const same = tick(s2, at(1, 980))

    expect(same.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBe(10 * MIB)
  })

  it('is null outside downloading', () => {
    const s1 = tick(EMPTY, at(0, 1000, 'Queued'))
    const s2 = tick(s1, at(1, 990, 'Queued'))

    expect(s2.readings.get(SAB_MOVIE_NZO_ID)?.speedBps).toBeNull()
  })
})

describe('reduceSabReads - transitions', () => {
  it('emits null -> X for new ids and nothing for an unchanged phase', () => {
    const queue = queueRead([
      slot({ nzo_id: SAB_MOVIE_NZO_ID, index: 0 }),
      slot({ nzo_id: SAB_EPISODE_NZO_ID, index: 1 }),
    ])
    const first = tick(EMPTY, { queue })
    const second = tick(first, { queue, now: NOW + 1000 })

    expect(first.transitions).toEqual([
      { nzoId: SAB_MOVIE_NZO_ID, from: null, to: 'downloading' },
      { nzoId: SAB_EPISODE_NZO_ID, from: null, to: 'queued' },
    ])
    expect(second.transitions).toEqual([])
  })

  it('emits one transition per changed id', () => {
    const first = tick(EMPTY, {
      queue: queueRead([
        slot({ nzo_id: SAB_MOVIE_NZO_ID, index: 0 }),
        slot({ nzo_id: SAB_EPISODE_NZO_ID, index: 1 }),
      ]),
    })
    // - Movie finished downloading; the episode moves up and starts.
    const second = tick(first, {
      queue: queueRead([slot({ nzo_id: SAB_EPISODE_NZO_ID, index: 0 })]),
      history: historyRead([historyRow('Verifying')]),
    })

    expect(second.transitions).toEqual([
      { nzoId: SAB_EPISODE_NZO_ID, from: 'queued', to: 'downloading' },
      { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'post_processing' },
    ])
  })

  it('emits nothing when a global pause lifts but the phase is unchanged', () => {
    const first = tick(EMPTY, {
      queue: queueRead([slot({ status: 'Paused' })], { paused: true }),
    })
    const second = tick(first, {
      queue: queueRead([slot({ status: 'Paused' })], { paused: false }),
    })

    expect(second.transitions).toEqual([])
    expect(second.readings.get(SAB_MOVIE_NZO_ID)?.globallyPaused).toBe(false)
  })
})
