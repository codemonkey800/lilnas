import { Logger } from '@nestjs/common'

import { MediaStateService } from 'src/media/media-state.service'
import {
  SAB_EPISODE_NZO_ID,
  SAB_MANUAL_NZO_ID,
  SAB_MOVIE_NZO_ID,
} from 'src/sabnzbd/__tests__/fixtures/sabnzbd.fixtures'
import { SAB_GONE_GRACE_TICKS } from 'src/sabnzbd/sab-readings.util'
import type {
  SabHistory,
  SabHistorySlot,
  SabQueue,
  SabQueueSlot,
} from 'src/sabnzbd/sabnzbd.schema'
import type {
  SabHistoryQuery,
  SabnzbdService,
} from 'src/sabnzbd/sabnzbd.service'
import { SabnzbdAuthError } from 'src/sabnzbd/sabnzbd.service'
import {
  SAB_POLL_MS,
  SAB_UNHEALTHY_AFTER,
  SabnzbdMonitorService,
} from 'src/sabnzbd/sabnzbd-monitor.service'

const NOW = 1_790_572_800_000

// - Builders for already-parsed reads, the shape SabnzbdService resolves.

function queueSlot(overrides: Partial<SabQueueSlot> = {}): SabQueueSlot {
  return {
    nzo_id: SAB_MOVIE_NZO_ID,
    index: 0,
    filename: 'A.Movie.2024.1080p',
    cat: 'movies',
    status: 'Downloading',
    priority: 'Normal',
    mb: 1000,
    mbleft: 400,
    percentage: 60,
    timeleft: 600,
    labels: [],
    ...overrides,
  }
}

function sabQueue(slots: SabQueueSlot[] = []): SabQueue {
  return {
    status: slots.length > 0 ? 'Downloading' : 'Idle',
    paused: false,
    kbpersec: 0,
    diskspace1: 500,
    timeleft: null,
    noofslots: slots.length,
    slots,
  }
}

function historySlot(overrides: Partial<SabHistorySlot> = {}): SabHistorySlot {
  return {
    nzo_id: SAB_MOVIE_NZO_ID,
    name: 'A.Movie.2024.1080p',
    status: 'Repairing',
    category: 'movies',
    action_line: 'Repairing: 45%',
    fail_message: '',
    bytes: 0,
    completed: 0,
    ...overrides,
  }
}

function sabHistory(slots: SabHistorySlot[] = [], lastUpdate = 1): SabHistory {
  return {
    last_history_update: lastUpdate,
    ppslots: slots.length,
    noofslots: slots.length,
    slots,
  }
}

describe('SabnzbdMonitorService', () => {
  let enabled: boolean
  let getQueue: jest.Mock<Promise<SabQueue>, []>
  let getHistory: jest.Mock<Promise<SabHistory | null>, [SabHistoryQuery]>
  let state: MediaStateService
  let monitor: SabnzbdMonitorService
  let now: number
  let log: jest.SpyInstance
  let warn: jest.SpyInstance
  let error: jest.SpyInstance

  /** Every non-archive `getHistory` query, in call order. */
  const historyQueries = (): SabHistoryQuery[] =>
    getHistory.mock.calls.map(([query]) => query).filter(q => !q.archive)
  const archiveQueries = (): SabHistoryQuery[] =>
    getHistory.mock.calls.map(([query]) => query).filter(q => q.archive)

  /** One tick, one poll-interval later than the last. */
  const tick = async (): Promise<void> => {
    now += SAB_POLL_MS
    await monitor.tick()
  }

  const track = (radarr: string[], sonarr: string[] = []): void => {
    state.setQueue(
      'radarr',
      radarr.map(downloadId => ({ downloadId })),
    )
    state.setQueue(
      'sonarr',
      sonarr.map(downloadId => ({ downloadId })),
    )
  }

  beforeEach(() => {
    enabled = true
    getQueue = jest.fn<Promise<SabQueue>, []>()
    getHistory = jest.fn<Promise<SabHistory | null>, [SabHistoryQuery]>()
    const sab = {
      get enabled() {
        return enabled
      },
      getQueue,
      getHistory,
      getVersion: jest.fn(),
    }

    state = new MediaStateService()
    monitor = new SabnzbdMonitorService(sab as unknown as SabnzbdService, state)

    now = NOW
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  it('polls once a second and goes unhealthy after three failures', () => {
    expect(SAB_POLL_MS).toBe(1_000)
    expect(SAB_UNHEALTHY_AFTER).toBe(3)
  })

  describe('disabled', () => {
    it('asks SAB nothing and leaves the health off', async () => {
      enabled = false
      track([SAB_MOVIE_NZO_ID])

      await tick()

      expect(getQueue).not.toHaveBeenCalled()
      expect(getHistory).not.toHaveBeenCalled()
      expect(state.clientHealth()).toBe('off')
      expect(state.clientReading(SAB_MOVIE_NZO_ID)).toBeUndefined()
    })
  })

  describe('active set', () => {
    it('asks SAB nothing while Radarr/Sonarr track nothing', async () => {
      track([])

      await tick()

      expect(getQueue).not.toHaveBeenCalled()
      expect(getHistory).not.toHaveBeenCalled()
      expect(state.clientHealth()).toBe('off')
    })

    it('clears the readings once the active set empties', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValue(sabQueue())
      getHistory.mockResolvedValue(
        sabHistory([historySlot({ status: 'Completed', action_line: '' })]),
      )
      await tick()
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('completed')

      // - Radarr imported it: a completed reading keeps nothing active.
      track([])
      getQueue.mockClear()
      getHistory.mockClear()
      await tick()

      expect(getQueue).not.toHaveBeenCalled()
      expect(getHistory).not.toHaveBeenCalled()
      expect(state.clientReading(SAB_MOVIE_NZO_ID)).toBeUndefined()
      expect(state.clientHealth()).toBe('ok')
    })

    it('keeps following a job Radarr stopped tracking until it ends', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValue(sabQueue([queueSlot()]))
      await tick()

      track([])
      await tick()

      expect(getQueue).toHaveBeenCalledTimes(2)
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('downloading')
    })

    it('keeps no reading for a SAB job nobody tracks', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValue(
        sabQueue([
          queueSlot({ nzo_id: SAB_MANUAL_NZO_ID, index: 0 }),
          queueSlot({ nzo_id: SAB_MOVIE_NZO_ID, index: 1 }),
        ]),
      )

      await tick()

      expect(state.clientReading(SAB_MANUAL_NZO_ID)).toBeUndefined()
      // - Still classified against the whole queue: the manual job ahead of
      //   it is the one transferring.
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('queued')
      expect(state.takeClientTransitions()).toEqual([
        { nzoId: SAB_MOVIE_NZO_ID, from: null, to: 'queued' },
      ])
    })

    it('ignores empty and missing download ids', async () => {
      state.setQueue('radarr', [{ downloadId: '' }, { downloadId: null }, {}])

      await tick()

      expect(getQueue).not.toHaveBeenCalled()
    })
  })

  describe('history', () => {
    it('is skipped while every active id is in the queue', async () => {
      track([SAB_MOVIE_NZO_ID], [SAB_EPISODE_NZO_ID])
      getQueue.mockResolvedValue(
        sabQueue([
          queueSlot({ nzo_id: SAB_MOVIE_NZO_ID, index: 0 }),
          queueSlot({ nzo_id: SAB_EPISODE_NZO_ID, index: 1 }),
        ]),
      )

      await tick()

      expect(getHistory).not.toHaveBeenCalled()
      expect(state.clientHealth()).toBe('ok')
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('downloading')
      expect(state.clientReading(SAB_EPISODE_NZO_ID)?.phase).toBe('queued')
    })

    it('is fetched the tick an id leaves the queue, and reads its post-processing', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      await tick()
      expect(getHistory).not.toHaveBeenCalled()

      getQueue.mockResolvedValue(sabQueue())
      getHistory.mockResolvedValue(sabHistory([historySlot()], 7))
      await tick()

      expect(historyQueries()).toEqual([
        { nzoIds: [SAB_MOVIE_NZO_ID], limit: 6, lastUpdate: undefined },
      ])
      expect(state.clientReading(SAB_MOVIE_NZO_ID)).toMatchObject({
        phase: 'post_processing',
        stage: 'Repairing',
        stageDetail: 'Repairing: 45%',
      })
      expect(state.takeClientTransitions()).toEqual([
        { nzoId: SAB_MOVIE_NZO_ID, from: null, to: 'downloading' },
        { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'post_processing' },
      ])
    })

    it('passes the last_history_update cursor on, and keeps it through a null answer', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValue(sabQueue())
      getHistory
        .mockResolvedValueOnce(sabHistory([historySlot()], 10))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      await tick()
      await tick()
      await tick()

      expect(historyQueries().map(q => q.lastUpdate)).toEqual([
        undefined,
        10,
        10,
      ])
      // - Unchanged history keeps the post-processing reading.
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe(
        'post_processing',
      )
    })

    it('drops the cursor when the ids it asks for change', async () => {
      track([SAB_MOVIE_NZO_ID], [SAB_EPISODE_NZO_ID])
      getQueue.mockResolvedValueOnce(
        sabQueue([queueSlot({ nzo_id: SAB_EPISODE_NZO_ID })]),
      )
      getHistory.mockResolvedValue(
        sabHistory(
          [
            historySlot(),
            historySlot({ nzo_id: SAB_EPISODE_NZO_ID, status: 'Verifying' }),
          ],
          10,
        ),
      )
      await tick()

      // - The episode left the queue: the old cursor was for the movie alone,
      //   so SAB could answer "unchanged" and hide the episode.
      getQueue.mockResolvedValue(sabQueue())
      await tick()

      expect(historyQueries()).toEqual([
        { nzoIds: [SAB_MOVIE_NZO_ID], limit: 6, lastUpdate: undefined },
        {
          nzoIds: [SAB_MOVIE_NZO_ID, SAB_EPISODE_NZO_ID],
          limit: 7,
          lastUpdate: undefined,
        },
      ])
      expect(state.clientReading(SAB_EPISODE_NZO_ID)?.phase).toBe(
        'post_processing',
      )
    })
  })

  describe('archive lookup', () => {
    /**
     * The movie downloads, then vanishes from both views while the episode
     * keeps post-processing; ticks until the movie's gone-grace runs out.
     */
    const vanishMovie = async (archived: SabHistorySlot[]): Promise<void> => {
      track([SAB_MOVIE_NZO_ID], [SAB_EPISODE_NZO_ID])
      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      getQueue.mockResolvedValue(sabQueue())
      getHistory.mockImplementation(async query =>
        query.archive
          ? sabHistory(archived, 99)
          : sabHistory(
              [historySlot({ nzo_id: SAB_EPISODE_NZO_ID, status: 'Moving' })],
              20,
            ),
      )

      await tick()
      for (let miss = 1; miss <= SAB_GONE_GRACE_TICKS; miss++) {
        await tick()
        expect(archiveQueries()).toHaveLength(0)
      }
      state.takeClientTransitions()

      // - The miss that would make it gone.
      await tick()
    }

    it('reads an archived job as completed', async () => {
      await vanishMovie([historySlot({ status: 'Completed', action_line: '' })])

      expect(archiveQueries()).toEqual([
        { nzoIds: [SAB_MOVIE_NZO_ID], limit: 1, archive: true },
      ])
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('completed')
      expect(state.takeClientTransitions()).toEqual([
        { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'completed' },
      ])
    })

    it('reads a job missing from the archive too as gone', async () => {
      await vanishMovie([])

      expect(archiveQueries()).toHaveLength(1)
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('gone')
      expect(state.takeClientTransitions()).toEqual([
        { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'gone' },
      ])
    })

    it('sends that tick’s history without the cursor and keeps the other post-processing ids', async () => {
      await vanishMovie([])

      const queries = historyQueries()
      // - Earlier same-id ticks used the cursor; the lookup tick must not.
      expect(queries.at(-2)?.lastUpdate).toBe(20)
      expect(queries.at(-1)?.lastUpdate).toBeUndefined()
      expect(state.clientReading(SAB_EPISODE_NZO_ID)?.phase).toBe(
        'post_processing',
      )
    })

    it('looks each id up only once', async () => {
      await vanishMovie([historySlot({ status: 'Completed', action_line: '' })])

      await tick()
      await tick()

      expect(archiveQueries()).toHaveLength(1)
    })
  })

  describe('health', () => {
    const failing = new Error('SABnzbd queue request failed')

    beforeEach(() => {
      track([SAB_MOVIE_NZO_ID])
    })

    it('goes ok on the first read, with one log line', async () => {
      getQueue.mockResolvedValue(sabQueue([queueSlot()]))

      await tick()
      await tick()

      expect(state.clientHealth()).toBe('ok')
      expect(log).toHaveBeenCalledTimes(1)
    })

    it('keeps the last readings through failures below the threshold', async () => {
      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      await tick()

      getQueue.mockRejectedValue(failing)
      for (let i = 1; i < SAB_UNHEALTHY_AFTER; i++) await tick()

      expect(state.clientHealth()).toBe('ok')
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('downloading')
      expect(warn).not.toHaveBeenCalled()
    })

    it('goes unhealthy after three failures, clears the readings and warns once', async () => {
      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      await tick()

      getQueue.mockRejectedValue(failing)
      for (let i = 0; i < SAB_UNHEALTHY_AFTER + 2; i++) await tick()

      expect(state.clientHealth()).toBe('unhealthy')
      expect(state.clientReading(SAB_MOVIE_NZO_ID)).toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'SABnzbd queue request failed',
          to: 'unhealthy',
        }),
        expect.any(String),
      )
    })

    it('recovers on one success, starting the reducer clean', async () => {
      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      await tick()
      state.takeClientTransitions()

      getQueue.mockRejectedValue(failing)
      for (let i = 0; i < SAB_UNHEALTHY_AFTER; i++) await tick()
      log.mockClear()

      getQueue.mockResolvedValue(sabQueue([queueSlot()]))
      await tick()

      expect(state.clientHealth()).toBe('ok')
      expect(log).toHaveBeenCalledTimes(1)
      expect(state.clientReading(SAB_MOVIE_NZO_ID)?.phase).toBe('downloading')
      // - Dropped state: the job reads as new, not as unchanged.
      expect(state.takeClientTransitions()).toEqual([
        { nzoId: SAB_MOVIE_NZO_ID, from: null, to: 'downloading' },
      ])
    })

    it('stays unhealthy through a tick with nothing to read', async () => {
      getQueue.mockRejectedValue(failing)
      for (let i = 0; i < SAB_UNHEALTHY_AFTER; i++) await tick()

      track([])
      await tick()

      expect(state.clientHealth()).toBe('unhealthy')
      expect(log).not.toHaveBeenCalled()
    })

    it('logs the API-key hint once per failing stretch', async () => {
      getQueue.mockRejectedValue(new SabnzbdAuthError())
      for (let i = 0; i < SAB_UNHEALTHY_AFTER + 2; i++) await tick()

      expect(error).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith(
        expect.anything(),
        'SABNZBD_API_KEY rejected - needs the full API key, not the NZB key',
      )

      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      await tick()
      await tick()

      expect(error).toHaveBeenCalledTimes(2)
    })

    it('counts a failed history read as a failed tick', async () => {
      getQueue.mockResolvedValue(sabQueue())
      getHistory.mockRejectedValue(new Error('SABnzbd history request failed'))

      for (let i = 0; i < SAB_UNHEALTHY_AFTER; i++) await tick()

      expect(state.clientHealth()).toBe('unhealthy')
    })
  })

  describe('transitions', () => {
    it('reach the store, and takeClientTransitions drains them', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValueOnce(sabQueue([queueSlot()]))
      getQueue.mockResolvedValueOnce(
        sabQueue([queueSlot({ status: 'Paused' })]),
      )

      await tick()
      await tick()

      expect(state.takeClientTransitions()).toEqual([
        { nzoId: SAB_MOVIE_NZO_ID, from: null, to: 'downloading' },
        { nzoId: SAB_MOVIE_NZO_ID, from: 'downloading', to: 'paused' },
      ])
      expect(state.takeClientTransitions()).toEqual([])
    })

    it('are not pushed when no phase changed', async () => {
      track([SAB_MOVIE_NZO_ID])
      getQueue.mockResolvedValue(sabQueue([queueSlot()]))
      await tick()
      state.takeClientTransitions()
      const push = jest.spyOn(state, 'pushClientTransitions')

      await tick()

      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('in-flight guard', () => {
    it('skips a tick while the previous one is still reading', async () => {
      track([SAB_MOVIE_NZO_ID])
      let release: (queue: SabQueue) => void = () => undefined
      getQueue.mockReturnValueOnce(
        new Promise<SabQueue>(resolve => {
          release = resolve
        }),
      )
      getQueue.mockResolvedValue(sabQueue([queueSlot()]))

      const first = monitor.tick()
      await monitor.tick()
      expect(getQueue).toHaveBeenCalledTimes(1)

      release(sabQueue([queueSlot()]))
      await first
      await tick()

      expect(getQueue).toHaveBeenCalledTimes(2)
    })
  })
})
