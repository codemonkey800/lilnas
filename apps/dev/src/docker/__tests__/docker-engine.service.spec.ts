import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs'

import {
  DockerEngineError,
  DockerEngineService,
  LogLine,
} from 'src/docker/docker-engine.service'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void

function frame(type: 1 | 2, text: string) {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(8)
  header[0] = type
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const inspectBody = (overrides: { Tty?: boolean } = {}) => ({
  Id: 'abc123',
  Name: '/web',
  Config: {
    Image: 'nginx:latest',
    Tty: overrides.Tty ?? false,
    Labels: { 'com.docker.compose.project': 'demo' },
  },
  State: {
    Status: 'running',
    ExitCode: 0,
    StartedAt: '2026-10-19T10:00:00.5Z',
    FinishedAt: '0001-01-01T00:00:00Z',
    Health: { Status: 'healthy' },
  },
  NetworkSettings: {
    Ports: {
      '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
      '443/tcp': null,
    },
  },
})

describe('DockerEngineService', () => {
  let server: http.Server
  let socketPath: string
  let handler: Handler
  let service: DockerEngineService
  const requests: string[] = []
  const requestUrl = (i: number) => new URL(requests[i] ?? '', 'http://engine')

  beforeEach(async () => {
    requests.length = 0
    handler = (_req, res) => json(res, 404, { message: 'not found' })
    socketPath = path.join(
      os.tmpdir(),
      `dev-docker-engine-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.sock`,
    )
    server = http.createServer((req, res) => {
      requests.push(req.url ?? '')
      handler(req, res)
    })
    await new Promise<void>(resolve => server.listen(socketPath, resolve))
    service = new DockerEngineService(socketPath)
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(socketPath, { force: true })
  })

  it('reads the socket path from DOCKER_SOCKET', async () => {
    process.env.DOCKER_SOCKET = socketPath
    try {
      handler = (_req, res) => json(res, 200, [])
      await expect(new DockerEngineService().listContainers()).resolves.toEqual(
        [],
      )
    } finally {
      delete process.env.DOCKER_SOCKET
    }
  })

  describe('listContainers', () => {
    it('maps the list payload and passes label filters', async () => {
      handler = (_req, res) =>
        json(res, 200, [
          {
            Id: 'abc123',
            Names: ['/web', '/alias'],
            State: 'running',
            Status: 'Up 2 hours (healthy)',
            Image: 'nginx:latest',
            Labels: { a: 'b' },
            Ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080 }],
          },
          {
            Id: 'def456',
            Names: ['/job'],
            State: 'exited',
            Status: 'Exited (1) 3 minutes ago',
            Image: 'busybox',
            Labels: null,
            Ports: [],
          },
        ])

      const list = await service.listContainers([
        'com.docker.compose.project',
        'traefik.enable=true',
      ])

      expect(list).toEqual([
        {
          id: 'abc123',
          name: 'web',
          state: 'running',
          status: 'Up 2 hours (healthy)',
          image: 'nginx:latest',
          labels: { a: 'b' },
          tty: false,
          ports: [{ ip: '0.0.0.0', publicPort: 8080, privatePort: 80 }],
        },
        expect.objectContaining({
          id: 'def456',
          name: 'job',
          state: 'exited',
          labels: {},
        }),
      ])
      expect(list[0]?.health).toBeUndefined()

      const url = requestUrl(0)
      expect(url.pathname).toBe('/containers/json')
      expect(url.searchParams.get('all')).toBe('true')
      expect(JSON.parse(url.searchParams.get('filters') ?? '')).toEqual({
        label: ['com.docker.compose.project', 'traefik.enable=true'],
      })
    })

    it('omits filters when none are given', async () => {
      handler = (_req, res) => json(res, 200, [])
      await service.listContainers()
      expect(requests[0]).toBe('/containers/json?all=true')
    })
  })

  describe('inspect', () => {
    it('fills health, timestamps, tty and ports', async () => {
      handler = (_req, res) => json(res, 200, inspectBody({ Tty: true }))

      const container = await service.inspect('web')

      expect(requests[0]).toBe('/containers/web/json')
      expect(container).toEqual({
        id: 'abc123',
        name: 'web',
        state: 'running',
        status: 'running (healthy)',
        health: 'healthy',
        image: 'nginx:latest',
        startedAt: '2026-10-19T10:00:00.5Z',
        finishedAt: undefined,
        exitCode: undefined,
        labels: { 'com.docker.compose.project': 'demo' },
        tty: true,
        ports: [
          { ip: '0.0.0.0', publicPort: 8080, privatePort: 80 },
          { privatePort: 443 },
        ],
      })
    })

    it('reports exit code and finish time for stopped containers', async () => {
      const body = inspectBody()
      body.State = {
        Status: 'exited',
        ExitCode: 137,
        StartedAt: '2026-10-19T10:00:00Z',
        FinishedAt: '2026-10-19T11:00:00Z',
        Health: undefined,
      } as unknown as typeof body.State
      handler = (_req, res) => json(res, 200, body)

      const container = await service.inspect('web')

      expect(container).toMatchObject({
        state: 'exited',
        status: 'exited',
        exitCode: 137,
        finishedAt: '2026-10-19T11:00:00Z',
      })
      expect(container?.health).toBeUndefined()
    })

    it('returns null on 404', async () => {
      handler = (_req, res) => json(res, 404, { message: 'No such container' })
      await expect(service.inspect('missing')).resolves.toBeNull()
    })

    it('throws DockerEngineError on 500', async () => {
      handler = (_req, res) => json(res, 500, { message: 'boom' })

      const err = await service.inspect('web').catch((e: unknown) => e)

      expect(err).toBeInstanceOf(DockerEngineError)
      expect(err).toMatchObject({ statusCode: 500, message: 'boom' })
    })
  })

  describe('listContainers errors', () => {
    it('throws DockerEngineError on non-2xx', async () => {
      handler = (_req, res) => {
        res.writeHead(500)
        res.end('plain failure')
      }

      await expect(service.listContainers()).rejects.toMatchObject({
        statusCode: 500,
        message: 'plain failure',
      })
    })
  })

  describe('stats', () => {
    it('applies the docker stats CPU and memory formulas', async () => {
      handler = (_req, res) =>
        json(res, 200, {
          cpu_stats: {
            cpu_usage: { total_usage: 600 },
            system_cpu_usage: 10_000,
            online_cpus: 4,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 400 },
            system_cpu_usage: 8_000,
          },
          memory_stats: {
            usage: 1_000,
            limit: 4_000,
            stats: { inactive_file: 250 },
          },
        })

      // (200 / 2000) * 4 * 100
      await expect(service.stats('abc')).resolves.toEqual({
        cpuPercent: 40,
        memoryBytes: 750,
        memoryLimitBytes: 4_000,
      })
      expect(requests[0]).toBe(
        '/containers/abc/stats?stream=false&one-shot=true',
      )
    })

    it('handles missing precpu, inactive_file and a zero system delta', async () => {
      handler = (_req, res) =>
        json(res, 200, {
          cpu_stats: { cpu_usage: { total_usage: 100 } },
          memory_stats: { usage: 500, limit: 900 },
        })

      await expect(service.stats('abc')).resolves.toEqual({
        cpuPercent: 0,
        memoryBytes: 500,
        memoryLimitBytes: 900,
      })
    })
  })

  describe('logs', () => {
    const logsHandler =
      (tty: boolean, writeBody: (res: http.ServerResponse) => void): Handler =>
      (req, res) => {
        if (req.url?.endsWith('/json')) {
          json(res, 200, inspectBody({ Tty: tty }))
          return
        }
        res.writeHead(200)
        writeBody(res)
      }

    const delay = () => new Promise(resolve => setTimeout(resolve, 15))

    it('demuxes a multiplexed body split across chunks', async () => {
      const body = Buffer.concat([
        frame(1, 'hello world\nsecond '),
        frame(2, 'oops\n'),
        frame(1, 'line\nlast-no-newline'),
      ])
      // Split mid-header of frame 1, then inside the "second line" payload
      // is not possible (it is in frame 1's tail), so cut inside frame 2's
      // header too.
      const chunks = [
        body.subarray(0, 5),
        body.subarray(5, 31),
        body.subarray(31),
      ]
      handler = logsHandler(false, res => {
        void (async () => {
          for (const chunk of chunks) {
            res.write(chunk)
            await delay()
          }
          res.end()
        })()
      })

      const lines = await lastValueFrom(
        service
          .logs('web', { tail: 100, timestamps: false, follow: false })
          .pipe(toArray()),
      )

      expect(lines).toEqual<LogLine[]>([
        { stream: 'stdout', text: 'hello world' },
        { stream: 'stderr', text: 'oops' },
        { stream: 'stdout', text: 'second line' },
        { stream: 'stdout', text: 'last-no-newline' },
      ])
      const logsUrl = requestUrl(1)
      expect(logsUrl.pathname).toBe('/containers/web/logs')
      expect(Object.fromEntries(logsUrl.searchParams)).toEqual({
        stdout: '1',
        stderr: '1',
        tail: '100',
        timestamps: '0',
        follow: '0',
      })
    })

    it('reads TTY containers as raw stdout text', async () => {
      handler = logsHandler(true, res => {
        res.write('raw one\r\nraw ')
        setTimeout(() => res.end('two\n'), 15)
      })

      const lines = await lastValueFrom(
        service
          .logs('web', { tail: 10, timestamps: false, follow: false })
          .pipe(toArray()),
      )

      expect(lines).toEqual<LogLine[]>([
        { stream: 'stdout', text: 'raw one' },
        { stream: 'stdout', text: 'raw two' },
      ])
    })

    it('splits the leading RFC3339 timestamp when requested', async () => {
      handler = logsHandler(false, res => {
        res.end(
          Buffer.concat([
            frame(1, '2026-10-19T10:00:00.123456789Z started up\n'),
            frame(2, '2026-10-19T10:00:01.000000000Z bad thing\n'),
          ]),
        )
      })

      const lines = await lastValueFrom(
        service
          .logs('web', { tail: 10, timestamps: true, follow: false })
          .pipe(toArray()),
      )

      expect(lines).toEqual<LogLine[]>([
        {
          stream: 'stdout',
          ts: '2026-10-19T10:00:00.123456789Z',
          text: 'started up',
        },
        {
          stream: 'stderr',
          ts: '2026-10-19T10:00:01.000000000Z',
          text: 'bad thing',
        },
      ])
      expect(requests[1]).toContain('timestamps=1')
    })

    it('errors with 404 when the container is missing', async () => {
      handler = (_req, res) => json(res, 404, { message: 'No such container' })

      await expect(
        lastValueFrom(
          service.logs('gone', { tail: 1, timestamps: false, follow: false }),
        ),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('ends the request when the subscriber unsubscribes', async () => {
      const closed = new Promise<void>(resolve => {
        handler = logsHandler(false, res => {
          res.on('close', resolve)
          res.write(frame(1, 'first\n'))
        })
      })

      const lines: LogLine[] = []
      await new Promise<void>(resolve => {
        const sub = service
          .logs('web', { tail: 1, timestamps: false, follow: true })
          .subscribe(line => {
            lines.push(line)
            sub?.unsubscribe()
            resolve()
          })
      })

      await closed
      expect(lines).toEqual([{ stream: 'stdout', text: 'first' }])
    })
  })

  describe('events', () => {
    it('parses one JSON object per line across chunks', async () => {
      const event = (action: string, id: string, time: number) =>
        JSON.stringify({
          Type: 'container',
          Action: action,
          Actor: { ID: id, Attributes: { name: `n-${id}`, image: 'x' } },
          time,
        })
      const first = event('start', 'aaa', 100)
      const second = event('die', 'bbb', 101)
      handler = (_req, res) => {
        res.writeHead(200)
        res.write(`${first}\n${second.slice(0, 20)}`)
        setTimeout(() => res.end(`${second.slice(20)}\n`), 15)
      }

      const events = await lastValueFrom(service.events().pipe(toArray()))

      expect(events).toEqual([
        {
          action: 'start',
          id: 'aaa',
          name: 'n-aaa',
          labels: { name: 'n-aaa', image: 'x' },
          time: 100,
        },
        {
          action: 'die',
          id: 'bbb',
          name: 'n-bbb',
          labels: { name: 'n-bbb', image: 'x' },
          time: 101,
        },
      ])
      const url = requestUrl(0)
      expect(url.pathname).toBe('/events')
      expect(JSON.parse(url.searchParams.get('filters') ?? '')).toEqual({
        type: ['container'],
      })
    })

    it('ends the request when the subscriber unsubscribes', async () => {
      const closed = new Promise<void>(resolve => {
        handler = (_req, res) => {
          res.on('close', resolve)
          res.writeHead(200)
          res.write(
            `${JSON.stringify({ Action: 'start', Actor: { ID: 'a' }, time: 1 })}\n`,
          )
        }
      })

      const event = await firstValueFrom(service.events())

      expect(event.action).toBe('start')
      await closed
    })
  })
})
