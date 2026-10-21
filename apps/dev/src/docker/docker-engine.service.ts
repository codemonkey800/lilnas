import { env } from '@lilnas/utils/env'
import { Inject, Injectable, Optional } from '@nestjs/common'
import http, { IncomingMessage } from 'http'
import { from, mergeMap, Observable, throwError } from 'rxjs'
import { StringDecoder } from 'string_decoder'

import { EnvKeys } from 'src/env'

export type ContainerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead'

export interface ContainerPort {
  ip?: string
  publicPort?: number
  privatePort: number
}

export interface ContainerSummary {
  id: string
  name: string // without the leading '/'
  state: ContainerState
  status: string // Docker's human string, e.g. "Up 2 hours (healthy)"
  health?: 'starting' | 'healthy' | 'unhealthy'
  image: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  labels: Record<string, string>
  tty: boolean
  ports: ContainerPort[]
}

export interface ContainerStats {
  cpuPercent: number
  memoryBytes: number
  memoryLimitBytes: number
}

export interface LogLine {
  stream: 'stdout' | 'stderr'
  text: string
  ts?: string
}

export interface DockerEvent {
  action: string
  id: string
  name?: string
  labels: Record<string, string>
  time: number
}

export interface LogOptions {
  tail: number
  timestamps: boolean
  follow: boolean
}

export class DockerEngineError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'DockerEngineError'
  }
}

/** Overrides the socket path, which otherwise comes from `DOCKER_SOCKET`. */
export const DOCKER_SOCKET_PATH = Symbol('DOCKER_SOCKET_PATH')

const DEFAULT_SOCKET = '/var/run/docker.sock'
const FRAME_HEADER_BYTES = 8
const ZERO_TIME_PREFIX = '0001-01-01'

interface EngineListContainer {
  Id: string
  Names?: string[]
  Image: string
  State: ContainerState
  Status: string
  Labels?: Record<string, string> | null
  Ports?: { IP?: string; PrivatePort: number; PublicPort?: number }[] | null
}

interface EngineInspect {
  Id: string
  Name: string
  Config: {
    Image: string
    Tty?: boolean
    Labels?: Record<string, string> | null
  }
  State: {
    Status: ContainerState
    ExitCode?: number
    StartedAt?: string
    FinishedAt?: string
    Health?: { Status: 'starting' | 'healthy' | 'unhealthy' }
  }
  NetworkSettings?: {
    Ports?: Record<
      string,
      { HostIp?: string; HostPort?: string }[] | null
    > | null
  }
}

interface EngineStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] | null }
    system_cpu_usage?: number
    online_cpus?: number
  }
  precpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
  }
  memory_stats?: {
    usage?: number
    limit?: number
    stats?: { inactive_file?: number }
  }
}

interface EngineEvent {
  Action?: string
  Actor?: { ID?: string; Attributes?: Record<string, string> }
  time?: number
}

/** Accumulates bytes and yields complete `\n`-terminated lines. */
class LineSplitter {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''

  push(chunk: Buffer): string[] {
    this.pending += this.decoder.write(chunk)
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    return lines.map(stripCr)
  }

  flush(): string | undefined {
    const rest = this.pending + this.decoder.end()
    this.pending = ''
    return rest ? stripCr(rest) : undefined
  }
}

function stripCr(line: string) {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function readBody(res: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    res.on('error', reject)
  })
}

function toEngineError(statusCode: number, body: string) {
  let message = body.trim() || `Docker Engine responded ${statusCode}`
  try {
    const parsed = JSON.parse(body) as { message?: string }
    if (parsed.message) message = parsed.message
  } catch {
    // Keep the raw body.
  }
  return new DockerEngineError(statusCode, message)
}

function isOk(statusCode: number | undefined) {
  return statusCode != null && statusCode >= 200 && statusCode < 300
}

function realTime(stamp: string | undefined) {
  return stamp && !stamp.startsWith(ZERO_TIME_PREFIX) ? stamp : undefined
}

function mapHealth(
  status: string | undefined,
): ContainerSummary['health'] | undefined {
  return status === 'starting' || status === 'healthy' || status === 'unhealthy'
    ? status
    : undefined
}

function mapInspectPorts(
  ports: NonNullable<EngineInspect['NetworkSettings']>['Ports'],
): ContainerPort[] {
  const result: ContainerPort[] = []
  for (const [key, bindings] of Object.entries(ports ?? {})) {
    const privatePort = Number(key.split('/')[0])
    if (!bindings?.length) {
      result.push({ privatePort })
      continue
    }
    for (const binding of bindings) {
      result.push({
        privatePort,
        ip: binding.HostIp || undefined,
        publicPort: binding.HostPort ? Number(binding.HostPort) : undefined,
      })
    }
  }
  return result
}

/**
 * Talks to the Docker Engine API with raw HTTP over the Unix socket, like
 * apps/portal/src/utils/docker-engine.ts.
 */
@Injectable()
export class DockerEngineService {
  private readonly socketPath: string

  constructor(@Optional() @Inject(DOCKER_SOCKET_PATH) socketPath?: string) {
    this.socketPath = socketPath ?? env(EnvKeys.DOCKER_SOCKET, DEFAULT_SOCKET)
  }

  /**
   * Lists every container (running or not). `health`, `startedAt`,
   * `finishedAt` and `exitCode` are left undefined and `tty` is false: those
   * only come from `inspect`.
   */
  async listContainers(labelFilters?: string[]): Promise<ContainerSummary[]> {
    const query = new URLSearchParams({ all: 'true' })
    if (labelFilters?.length) {
      query.set('filters', JSON.stringify({ label: labelFilters }))
    }

    const list = await this.getJson<EngineListContainer[]>(
      `/containers/json?${query}`,
    )

    return list.map(c => ({
      id: c.Id,
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
      state: c.State,
      status: c.Status,
      image: c.Image,
      labels: c.Labels ?? {},
      tty: false,
      ports: (c.Ports ?? []).map(p => ({
        ip: p.IP || undefined,
        publicPort: p.PublicPort,
        privatePort: p.PrivatePort,
      })),
    }))
  }

  /**
   * Returns the full summary for one container, or null when it does not
   * exist. The engine's inspect has no human `Status` string, so `status` is
   * the state plus the health when there is one.
   */
  async inspect(idOrName: string): Promise<ContainerSummary | null> {
    let data: EngineInspect
    try {
      data = await this.getJson<EngineInspect>(
        `/containers/${encodeURIComponent(idOrName)}/json`,
      )
    } catch (err) {
      if (err instanceof DockerEngineError && err.statusCode === 404) {
        return null
      }
      throw err
    }

    const { State: state } = data
    const health = mapHealth(state.Health?.Status)
    const stopped =
      state.Status === 'exited' ||
      state.Status === 'dead' ||
      state.Status === 'restarting'

    return {
      id: data.Id,
      name: data.Name.replace(/^\//, ''),
      state: state.Status,
      status: health ? `${state.Status} (${health})` : state.Status,
      health,
      image: data.Config.Image,
      startedAt: realTime(state.StartedAt),
      finishedAt: realTime(state.FinishedAt),
      exitCode: stopped ? state.ExitCode : undefined,
      labels: data.Config.Labels ?? {},
      tty: data.Config.Tty ?? false,
      ports: mapInspectPorts(data.NetworkSettings?.Ports),
    }
  }

  async stats(id: string): Promise<ContainerStats> {
    const s = await this.getJson<EngineStats>(
      `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`,
    )

    const cpuDelta =
      (s.cpu_stats?.cpu_usage?.total_usage ?? 0) -
      (s.precpu_stats?.cpu_usage?.total_usage ?? 0)
    const systemDelta =
      (s.cpu_stats?.system_cpu_usage ?? 0) -
      (s.precpu_stats?.system_cpu_usage ?? 0)
    const onlineCpus =
      s.cpu_stats?.online_cpus ||
      s.cpu_stats?.cpu_usage?.percpu_usage?.length ||
      1

    return {
      cpuPercent:
        systemDelta > 0 && cpuDelta > 0
          ? (cpuDelta / systemDelta) * onlineCpus * 100
          : 0,
      memoryBytes:
        (s.memory_stats?.usage ?? 0) -
        (s.memory_stats?.stats?.inactive_file ?? 0),
      memoryLimitBytes: s.memory_stats?.limit ?? 0,
    }
  }

  /**
   * Streams log lines. Unsubscribing aborts the request. A missing container
   * errors with a 404 DockerEngineError.
   */
  logs(id: string, opts: LogOptions): Observable<LogLine> {
    const query = new URLSearchParams({
      stdout: '1',
      stderr: '1',
      tail: String(opts.tail),
      timestamps: opts.timestamps ? '1' : '0',
      follow: opts.follow ? '1' : '0',
    })
    const path = `/containers/${encodeURIComponent(id)}/logs?${query}`

    // The body framing depends on whether the container has a TTY.
    return from(this.inspect(id)).pipe(
      mergeMap(container =>
        container
          ? demuxLogs(this.openBody(path), container.tty, opts.timestamps)
          : throwError(
              () => new DockerEngineError(404, `No such container: ${id}`),
            ),
      ),
    )
  }

  /** Streams container lifecycle events until unsubscribed. */
  events(): Observable<DockerEvent> {
    const filters = encodeURIComponent(JSON.stringify({ type: ['container'] }))
    const body = this.openBody(`/events?filters=${filters}`)

    return new Observable<DockerEvent>(subscriber => {
      const splitter = new LineSplitter()
      const emit = (line: string) => {
        if (!line.trim()) return
        let raw: EngineEvent
        try {
          raw = JSON.parse(line) as EngineEvent
        } catch {
          return
        }
        const attributes = raw.Actor?.Attributes ?? {}
        subscriber.next({
          action: raw.Action ?? '',
          id: raw.Actor?.ID ?? '',
          name: attributes.name,
          labels: attributes,
          time: raw.time ?? 0,
        })
      }

      return body.subscribe({
        next: chunk => splitter.push(chunk).forEach(emit),
        error: err => subscriber.error(err),
        complete: () => {
          const rest = splitter.flush()
          if (rest) emit(rest)
          subscriber.complete()
        },
      })
    })
  }

  private async getJson<T>(path: string): Promise<T> {
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        { socketPath: this.socketPath, method: 'GET', path },
        res => {
          readBody(res).then(text => {
            if (isOk(res.statusCode)) {
              resolve(text)
            } else {
              reject(toEngineError(res.statusCode ?? 0, text))
            }
          }, reject)
        },
      )
      req.on('error', reject)
      req.end()
    })

    return JSON.parse(body) as T
  }

  /** Emits raw body chunks; unsubscribing destroys the request. */
  private openBody(path: string): Observable<Buffer> {
    return new Observable<Buffer>(subscriber => {
      const req = http.request(
        { socketPath: this.socketPath, method: 'GET', path },
        res => {
          if (!isOk(res.statusCode)) {
            readBody(res).then(
              text =>
                subscriber.error(toEngineError(res.statusCode ?? 0, text)),
              err => subscriber.error(err),
            )
            return
          }

          res.on('data', (chunk: Buffer) => subscriber.next(chunk))
          res.on('end', () => subscriber.complete())
          res.on('error', err => subscriber.error(err))
        },
      )
      req.on('error', err => subscriber.error(err))
      req.end()

      return () => req.destroy()
    })
  }
}

function toLogLine(
  stream: LogLine['stream'],
  line: string,
  timestamps: boolean,
): LogLine {
  if (timestamps) {
    const space = line.indexOf(' ')
    if (space > 0) {
      return { stream, ts: line.slice(0, space), text: line.slice(space + 1) }
    }
  }
  return { stream, text: line }
}

/**
 * Turns the raw logs body into lines. Non-TTY bodies are multiplexed into
 * frames of `[type, 0, 0, 0, size(BE u32)]` + payload; frames and lines may
 * both split across chunks, so each is carried over until complete. TTY bodies
 * are plain text, treated as stdout.
 */
function demuxLogs(
  body: Observable<Buffer>,
  tty: boolean,
  timestamps: boolean,
): Observable<LogLine> {
  return new Observable<LogLine>(subscriber => {
    const splitters = {
      stdout: new LineSplitter(),
      stderr: new LineSplitter(),
    }
    let carry: Buffer = Buffer.alloc(0)

    const emitLines = (stream: LogLine['stream'], lines: string[]) => {
      for (const line of lines) {
        subscriber.next(toLogLine(stream, line, timestamps))
      }
    }

    return body.subscribe({
      next: chunk => {
        if (tty) {
          emitLines('stdout', splitters.stdout.push(chunk))
          return
        }

        carry = carry.length ? Buffer.concat([carry, chunk]) : chunk
        while (carry.length >= FRAME_HEADER_BYTES) {
          const size = carry.readUInt32BE(4)
          const end = FRAME_HEADER_BYTES + size
          if (carry.length < end) break

          const stream = carry[0] === 2 ? 'stderr' : 'stdout'
          emitLines(
            stream,
            splitters[stream].push(carry.subarray(FRAME_HEADER_BYTES, end)),
          )
          carry = carry.subarray(end)
        }
      },
      error: err => subscriber.error(err),
      complete: () => {
        for (const stream of ['stdout', 'stderr'] as const) {
          const rest = splitters[stream].flush()
          if (rest != null) emitLines(stream, [rest])
        }
        subscriber.complete()
      },
    })
  })
}
