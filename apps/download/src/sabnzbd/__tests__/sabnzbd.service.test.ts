import { Test, TestingModule } from '@nestjs/testing'

import {
  parseSabDuration,
  SabHistorySlotSchema,
  SabQueueSchema,
} from 'src/sabnzbd/sabnzbd.schema'
import {
  isSabReadMode,
  SAB_READ_MODES,
  SabnzbdApiError,
  SabnzbdAuthError,
  SabnzbdService,
} from 'src/sabnzbd/sabnzbd.service'

import {
  SAB_API_ERROR,
  SAB_DISK_FULL_FAIL_MESSAGE,
  SAB_EPISODE_NZO_ID,
  SAB_FORBIDDEN_API_KEY_INCORRECT,
  SAB_FORBIDDEN_API_KEY_REQUIRED,
  SAB_FORBIDDEN_EXTERNAL_ACCESS,
  SAB_FORBIDDEN_HOSTNAME,
  SAB_HISTORY_ARCHIVED_COMPLETED,
  SAB_HISTORY_FAILED_DISK_FULL,
  SAB_HISTORY_PP_REPAIRING,
  SAB_HISTORY_UNCHANGED,
  SAB_MANUAL_NZO_ID,
  SAB_MOVIE_NZO_ID,
  SAB_QUEUE_DOWNLOADING,
  SAB_QUEUE_IDLE,
  SAB_QUEUE_PAUSED,
  SAB_VERSION,
} from './fixtures/sabnzbd.fixtures'

const SAB_URL = 'http://sabnzbd:8080'
const SAB_API_KEY = 'sab-full-api-key-0123456789abcdef'

/** A real Response, so `ok`/`status`/`json()` behave as in production. */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** SAB's 403s are plain text (or empty with `api_warnings` off). */
function forbiddenResponse(body: string): Response {
  return new Response(body, {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  })
}

/** The URL a given fetch call was made against, parsed for assertions. */
function requestedUrl(
  fetchSpy: jest.SpiedFunction<typeof fetch>,
  call = 0,
): URL {
  const args = fetchSpy.mock.calls[call]

  if (!args) {
    throw new Error(`fetch was never called a ${call + 1}th time`)
  }

  const [input] = args
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

  return new URL(href)
}

/** Awaits a promise expected to reject and hands back what it threw. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject')
    },
    (thrown: unknown) => {
      if (!(thrown instanceof Error)) {
        throw new Error(`expected an Error, got ${String(thrown)}`)
      }

      return thrown
    },
  )
}

/** Asserts neither the key nor the base URL appears in an error or its cause. */
function expectNoSecrets(error: Error): void {
  const cause: unknown = error.cause
  const texts = [error.message, error.stack ?? '', String(cause ?? '')]

  if (cause instanceof Error) {
    texts.push(cause.message, cause.stack ?? '')
  }

  for (const text of texts) {
    expect(text).not.toContain(SAB_API_KEY)
    expect(text).not.toContain(SAB_URL)
    expect(text).not.toContain('sabnzbd:8080')
  }
}

/** The private request(), reached for the read-only guard test. */
interface RequestAccess {
  request(mode: string, schema: unknown): Promise<unknown>
}

describe('SabnzbdService', () => {
  let service: SabnzbdService
  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let originalEnv: NodeJS.ProcessEnv

  async function createService(): Promise<SabnzbdService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SabnzbdService],
    }).compile()

    return module.get<SabnzbdService>(SabnzbdService)
  }

  beforeEach(async () => {
    originalEnv = { ...process.env }
    process.env.SABNZBD_URL = SAB_URL
    process.env.SABNZBD_API_KEY = SAB_API_KEY

    fetchSpy = jest.spyOn(global, 'fetch')

    service = await createService()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('enabled', () => {
    it('is true when both SABNZBD_URL and SABNZBD_API_KEY are set', () => {
      expect(service.enabled).toBe(true)
    })

    it('is false, and construction does not throw, when SABNZBD_URL is unset', async () => {
      delete process.env.SABNZBD_URL

      await expect(createService()).resolves.toHaveProperty('enabled', false)
    })

    it('is false when SABNZBD_API_KEY is unset', async () => {
      delete process.env.SABNZBD_API_KEY

      await expect(createService()).resolves.toHaveProperty('enabled', false)
    })

    it('is false when both are unset', async () => {
      delete process.env.SABNZBD_URL
      delete process.env.SABNZBD_API_KEY

      await expect(createService()).resolves.toHaveProperty('enabled', false)
    })

    it('is false when a var is set but blank', async () => {
      process.env.SABNZBD_API_KEY = '  '

      await expect(createService()).resolves.toHaveProperty('enabled', false)
    })

    it('makes no request when disabled', async () => {
      delete process.env.SABNZBD_API_KEY
      service = await createService()

      await expect(service.getQueue()).rejects.toThrow('not configured')
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('read-only guard', () => {
    it('allowlists exactly version, queue and history', () => {
      expect(SAB_READ_MODES).toEqual(['version', 'queue', 'history'])
      expect(isSabReadMode('queue')).toBe(true)
      expect(isSabReadMode('delete')).toBe(false)
      expect(isSabReadMode('config')).toBe(false)
    })

    it.each(['delete', 'change_cat', 'retry', 'config', 'shutdown', 'Queue'])(
      'refuses mode=%s before fetch is called',
      async mode => {
        const access = service as unknown as RequestAccess

        await expect(access.request(mode, SAB_VERSION)).rejects.toThrow(
          'read-only',
        )
        expect(fetchSpy).not.toHaveBeenCalled()
      },
    )
  })

  describe('request building', () => {
    it('GETs {SABNZBD_URL}/api with mode, output=json and apikey', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_VERSION))

      await service.getVersion()

      const url = requestedUrl(fetchSpy)
      expect(url.origin).toBe(SAB_URL)
      expect(url.pathname).toBe('/api')
      expect(url.searchParams.get('mode')).toBe('version')
      expect(url.searchParams.get('output')).toBe('json')
      expect(url.searchParams.get('apikey')).toBe(SAB_API_KEY)
    })

    it('does not double the slash when SABNZBD_URL has a trailing slash', async () => {
      process.env.SABNZBD_URL = `${SAB_URL}/`
      service = await createService()
      fetchSpy.mockResolvedValue(jsonResponse(SAB_VERSION))

      await service.getVersion()

      expect(requestedUrl(fetchSpy).pathname).toBe('/api')
    })

    it('passes a 10s AbortSignal.timeout to fetch', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
      fetchSpy.mockResolvedValue(jsonResponse(SAB_VERSION))

      await service.getVersion()

      expect(timeoutSpy).toHaveBeenCalledWith(10_000)
      expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(
        timeoutSpy.mock.results[0]?.value,
      )
    })
  })

  describe('getVersion', () => {
    it('returns the version string', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_VERSION))

      await expect(service.getVersion()).resolves.toBe('5.1.3')
    })
  })

  describe('getQueue', () => {
    it('asks for the whole queue, unfiltered', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_QUEUE_IDLE))

      await service.getQueue()

      const params = requestedUrl(fetchSpy).searchParams
      expect(params.get('mode')).toBe('queue')
      expect(params.get('limit')).toBe('0')
      expect(params.has('cat')).toBe(false)
      expect(params.has('category')).toBe(false)
      expect(params.has('nzo_ids')).toBe(false)
    })

    it('parses an idle queue', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_QUEUE_IDLE))

      const queue = await service.getQueue()

      expect(queue).toMatchObject({
        status: 'Idle',
        paused: false,
        kbpersec: 0,
        diskspace1: 1843.21,
        timeleft: 0,
        noofslots: 0,
        slots: [],
      })
    })

    it('parses a downloading queue, coercing SAB string numbers', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_QUEUE_DOWNLOADING))

      const queue = await service.getQueue()

      expect(queue).toMatchObject({
        status: 'Downloading',
        paused: false,
        kbpersec: 100,
        // - 1:02:12:51
        timeleft: 94_371,
        noofslots: 2,
      })
      expect(queue.slots).toHaveLength(2)
      expect(queue.slots[0]).toMatchObject({
        nzo_id: SAB_MOVIE_NZO_ID,
        index: 0,
        cat: 'movies',
        status: 'Downloading',
        priority: 'Normal',
        mb: 8192,
        mbleft: 3072,
        percentage: 62,
        // - 8:44:17
        timeleft: 31_457,
        labels: [],
      })
      expect(queue.slots[1]).toMatchObject({
        nzo_id: SAB_EPISODE_NZO_ID,
        index: 1,
        cat: 'tv',
        priority: 0,
        mb: 6144,
        mbleft: 6144,
        percentage: 0,
        timeleft: 94_371,
        labels: ['ENCRYPTED'],
      })
    })

    it('parses a paused queue and maps cat "None" to null', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_QUEUE_PAUSED))

      const queue = await service.getQueue()

      expect(queue.status).toBe('Paused')
      expect(queue.paused).toBe(true)
      expect(queue.slots.map(slot => slot.status)).toEqual([
        'Queued',
        'Queued',
        'Paused',
      ])

      const manual = queue.slots.find(slot => slot.nzo_id === SAB_MANUAL_NZO_ID)
      expect(manual?.cat).toBeNull()
      expect(manual?.priority).toBe('Low')
      expect(manual?.timeleft).toBe(0)
    })

    it('passes unknown SAB fields through', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_QUEUE_DOWNLOADING))

      const queue = await service.getQueue()

      expect(queue.noofslots_total).toBe(2)
      expect(queue.slots[0]?.time_added).toBe(
        SAB_QUEUE_DOWNLOADING.queue.slots[0].time_added,
      )
    })
  })

  describe('getHistory', () => {
    it('sends nzo_ids comma-joined, an explicit limit and no archive by default', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_HISTORY_PP_REPAIRING))

      await service.getHistory({
        nzoIds: [SAB_MOVIE_NZO_ID, SAB_EPISODE_NZO_ID],
        limit: 10,
      })

      const params = requestedUrl(fetchSpy).searchParams
      expect(params.get('mode')).toBe('history')
      expect(params.get('output')).toBe('json')
      expect(params.get('nzo_ids')).toBe(
        `${SAB_MOVIE_NZO_ID},${SAB_EPISODE_NZO_ID}`,
      )
      expect(params.get('limit')).toBe('10')
      expect(params.has('archive')).toBe(false)
      expect(params.has('last_history_update')).toBe(false)
    })

    it('sends archive=1 and last_history_update when asked', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_HISTORY_ARCHIVED_COMPLETED))

      await service.getHistory({
        nzoIds: [SAB_MOVIE_NZO_ID],
        limit: 1,
        archive: true,
        lastUpdate: 11,
      })

      const params = requestedUrl(fetchSpy).searchParams
      expect(params.get('archive')).toBe('1')
      expect(params.get('last_history_update')).toBe('11')
      expect(params.get('limit')).toBe('1')
    })

    it('parses a post-processing row', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_HISTORY_PP_REPAIRING))

      const history = await service.getHistory({
        nzoIds: [SAB_MOVIE_NZO_ID],
        limit: 10,
      })

      expect(history).toMatchObject({
        last_history_update: 10,
        ppslots: 1,
        noofslots: 1,
      })
      expect(history?.slots[0]).toMatchObject({
        nzo_id: SAB_MOVIE_NZO_ID,
        status: 'Repairing',
        category: 'movies',
        action_line: 'Repairing: 45%  - 1:23 left',
        fail_message: '',
        bytes: 8_589_934_592,
        completed: 1_790_572_780,
      })
    })

    it('parses an archived completed DB row', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_HISTORY_ARCHIVED_COMPLETED))

      const history = await service.getHistory({
        nzoIds: [SAB_MOVIE_NZO_ID],
        limit: 10,
        archive: true,
      })

      expect(history).toMatchObject({ last_history_update: 12, ppslots: 0 })
      expect(history?.slots[0]).toMatchObject({
        status: 'Completed',
        action_line: '',
        completed: 1_790_572_831,
      })
      // - DB rows carry null series/meta/completeness; they pass through.
      expect(history?.slots[0]?.series).toBeNull()
    })

    it('parses a failed disk-full DB row', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_HISTORY_FAILED_DISK_FULL))

      const history = await service.getHistory({
        nzoIds: [SAB_EPISODE_NZO_ID],
        limit: 10,
      })

      expect(history?.slots[0]).toMatchObject({
        nzo_id: SAB_EPISODE_NZO_ID,
        status: 'Failed',
        category: 'tv',
        fail_message: SAB_DISK_FULL_FAIL_MESSAGE,
        bytes: 6_442_450_944,
      })
    })

    it('resolves null when SAB says the history is unchanged', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_HISTORY_UNCHANGED))

      await expect(
        service.getHistory({
          nzoIds: [SAB_MOVIE_NZO_ID],
          limit: 10,
          lastUpdate: 12,
        }),
      ).resolves.toBeNull()
    })

    it('makes no request for an empty nzoIds and echoes lastUpdate', async () => {
      await expect(
        service.getHistory({ nzoIds: [], limit: 10, lastUpdate: 7 }),
      ).resolves.toEqual({
        last_history_update: 7,
        ppslots: 0,
        noofslots: 0,
        slots: [],
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('returns counter 0 for an empty nzoIds with no lastUpdate', async () => {
      const history = await service.getHistory({ nzoIds: [], limit: 10 })

      expect(history?.last_history_update).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it.each([0, -1, 1.5, Number.NaN])(
      'throws on limit %p without calling fetch',
      async limit => {
        await expect(
          service.getHistory({ nzoIds: [SAB_MOVIE_NZO_ID], limit }),
        ).rejects.toThrow('limit must be an integer >= 1')
        expect(fetchSpy).not.toHaveBeenCalled()
      },
    )
  })

  describe('errors', () => {
    it.each([
      ['API Key Incorrect', SAB_FORBIDDEN_API_KEY_INCORRECT],
      ['API Key Required', SAB_FORBIDDEN_API_KEY_REQUIRED],
      ['hostname', SAB_FORBIDDEN_HOSTNAME],
      ['external access', SAB_FORBIDDEN_EXTERNAL_ACCESS],
      ['an empty body', ''],
    ])(
      'maps a 403 with %s to SabnzbdAuthError, without the body',
      async (_, body) => {
        fetchSpy.mockResolvedValue(forbiddenResponse(body))

        const error = await rejectionOf(service.getQueue())

        expect(error).toBeInstanceOf(SabnzbdAuthError)
        expect(error.message).toContain('API key or host')
        if (body) expect(error.message).not.toContain(body)
        expectNoSecrets(error)
      },
    )

    it('throws an error naming the mode and status on other non-2xx', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html>oops</html>', { status: 502 }),
      )

      const error = await rejectionOf(service.getQueue())

      expect(error.message).toBe('SABnzbd queue request failed with HTTP 502')
      expectNoSecrets(error)
    })

    it('throws SabnzbdApiError with SAB text on a 200 {status:false}', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(SAB_API_ERROR))

      const error = await rejectionOf(service.getVersion())

      expect(error).toBeInstanceOf(SabnzbdApiError)
      expect(error.message).toContain('not implemented')
      expect((error as SabnzbdApiError).sabError).toBe('not implemented')
      expect((error as SabnzbdApiError).mode).toBe('version')
    })

    it('rewraps a network failure without the URL, key or cause', async () => {
      const leakyUrl = `${SAB_URL}/api?mode=queue&apikey=${SAB_API_KEY}`
      fetchSpy.mockRejectedValue(
        new TypeError('fetch failed', {
          cause: new Error(`connect ECONNREFUSED ${leakyUrl}`),
        }),
      )

      const error = await rejectionOf(service.getQueue())

      expect(error.message).toBe('SABnzbd queue request failed')
      expect(error.cause).toBeUndefined()
      expectNoSecrets(error)
    })

    it('says a timeout timed out', async () => {
      fetchSpy.mockRejectedValue(
        new DOMException('The operation was aborted.', 'TimeoutError'),
      )

      const error = await rejectionOf(service.getVersion())

      expect(error.message).toBe('SABnzbd version request failed (timed out)')
    })

    it('rejects a body that does not match the schema, without the URL or key', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ queue: { status: 'Idle', slots: 'nope' } }),
      )

      const error = await rejectionOf(service.getQueue())

      expect(error.message).toContain(
        'SABnzbd queue response did not match the expected shape',
      )
      expectNoSecrets(error)
    })

    it('rejects a 200 body that is not JSON', async () => {
      fetchSpy.mockResolvedValue(new Response('<html>login</html>'))

      const error = await rejectionOf(service.getVersion())

      expect(error.message).toBe('SABnzbd version response was not valid JSON')
      expectNoSecrets(error)
    })
  })
})

describe('parseSabDuration', () => {
  it.each([
    ['0:00:00', 0],
    ['0:00:09', 9],
    ['8:44:17', 31_457],
    ['23:59:59', 86_399],
    ['1:02:12:51', 94_371],
    ['12:00:00:00', 1_036_800],
  ])('parses %s to %i seconds', (value, seconds) => {
    expect(parseSabDuration(value)).toBe(seconds)
  })

  it.each([
    '',
    'junk',
    '12:34',
    '1:2:3:4:5',
    '1:60:00',
    '1:00:60',
    '1:24:00:00',
    '-1:00:00',
    '1.5:00:00',
    '1::00',
    'a:bc:de',
  ])('returns null for %p', value => {
    expect(parseSabDuration(value)).toBeNull()
  })
})

describe('schema tolerance', () => {
  const [queueSlot] = SAB_QUEUE_DOWNLOADING.queue.slots
  const [historySlot] = SAB_HISTORY_FAILED_DISK_FULL.history.slots

  it('reads a junk queue or slot timeleft as null instead of failing', () => {
    const queue = SabQueueSchema.parse({
      ...SAB_QUEUE_DOWNLOADING.queue,
      timeleft: 'soon',
      slots: [{ ...queueSlot, timeleft: '??' }],
    })

    expect(queue.timeleft).toBeNull()
    expect(queue.slots[0]?.timeleft).toBeNull()
  })

  it('reads a junk diskspace1 as null instead of failing', () => {
    for (const diskspace1 of ['', 'n/a', null]) {
      expect(
        SabQueueSchema.parse({ ...SAB_QUEUE_IDLE.queue, diskspace1 })
          .diskspace1,
      ).toBeNull()
    }
  })

  it('fails loudly on a junk mb, which progress math depends on', () => {
    expect(() =>
      SabQueueSchema.parse({
        ...SAB_QUEUE_DOWNLOADING.queue,
        slots: [{ ...queueSlot, mbleft: 'lots' }],
      }),
    ).toThrow()
  })

  it('normalises null history text columns and bytes from old DB rows', () => {
    const slot = SabHistorySlotSchema.parse({
      ...historySlot,
      category: null,
      fail_message: null,
      action_line: null,
      bytes: null,
    })

    expect(slot).toMatchObject({
      category: null,
      fail_message: '',
      action_line: '',
      bytes: 0,
    })
  })
})
