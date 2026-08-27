/**
 * Transport layer for the backend verification script.
 *
 * Two implementations, one signature:
 *
 * - `dockerExecTransport` runs `docker compose exec -T download curl ...`
 *   **directly on the lilnas host** (no `ssh` hop) and talks to the Nest
 *   backend on port 8081. Port 8080 is Next.js — never use it here.
 * - `httpTransport` is the plain-`fetch` variant for local/dev runs.
 *
 * Both are `Transport`, so the runner can swap them without caring which is
 * in play.
 *
 * Two failure kinds are kept structurally distinct:
 *
 * - **Transport failure** — `TransportError` is thrown. "We could not reach
 *   the container / the host / the port at all."
 * - **HTTP failure** — resolves normally with a non-2xx `RouteResponse`. "The
 *   backend answered, and the answer was bad." The body is the evidence, so
 *   it is returned rather than discarded.
 */
import { spawn } from 'node:child_process'

/** Nest listens here. 8080 is Next.js — see `apps/download/next.config.js`. */
const NEST_PORT = 8081

/** Compose service name in the root `docker-compose.yml`. */
const DEFAULT_SERVICE = 'download'

/** Matches the `--max-time 30` in the plan. */
const DEFAULT_TIMEOUT_SECONDS = 30

/**
 * Grace period on top of curl's own `--max-time` before we kill the child.
 * Covers a wedged `docker compose exec` that never hands off to curl.
 */
const SPAWN_GRACE_MS = 15_000

/**
 * Hard ceiling on collected stdout. Belt-and-braces: `bodyMode:
 * 'headers-only'` already sends the body to `/dev/null`, but if a route is
 * ever mis-tagged we still refuse to pull a multi-gigabyte movie into the
 * runner's memory.
 */
const MAX_STDOUT_BYTES = 32 * 1024 * 1024

/** Cap on collected stderr — curl's error text is short, a runaway log is not. */
const MAX_STDERR_CHARS = 8192

/** `HTTP/1.1 200 OK` / `HTTP/2 404`. */
const STATUS_LINE = /^HTTP\/\d(?:\.\d)?[ \t]+(\d{3})/

/** RFC 7230 token. */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/

/**
 * ASCII control characters, which must never reach curl's argv or a URL.
 * Built from a string so the source stays free of literal control bytes.
 *
 * `no-control-regex` is disabled deliberately: matching control characters is
 * the entire point here, since a CR or LF reaching curl's `-H` argv is a
 * header-injection vector.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]')

export interface RouteResponse {
  status: number
  headers: Record<string, string>
  body: string
  durationMs: number
}

/**
 * `'headers-only'` never buffers the response body — required for
 * `GET /download/media/:id/file`, which streams the whole media file.
 */
export type BodyMode = 'json' | 'headers-only'

export interface RequestOptions {
  /** Defaults to `'json'`. */
  bodyMode?: BodyMode
  /** Per-request override of the 30s default. */
  timeoutSeconds?: number
}

/**
 * The third argument is optional, so a caller that only needs the default
 * JSON behaviour can ignore it entirely and both implementations stay
 * interchangeable.
 */
export type Transport = (
  path: string,
  headers: Record<string, string>,
  options?: RequestOptions,
) => Promise<RouteResponse>

export type TransportFailureReason =
  /** The `docker` binary (or the runtime) could not be started at all. */
  | 'spawn-failed'
  /** We killed the child, or curl gave up, before a response arrived. */
  | 'timeout'
  /** `docker compose exec` / curl exited non-zero. */
  | 'nonzero-exit'
  /** Response blew past `MAX_STDOUT_BYTES` — almost certainly a mis-tagged route. */
  | 'output-too-large'
  /** Something answered, but it was not a parseable HTTP response head. */
  | 'unparsable-response'
  /** `fetch` could not establish or complete the connection. */
  | 'network'

export interface TransportErrorDetails {
  reason: TransportFailureReason
  command?: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  stderr?: string
  cause?: unknown
}

/**
 * "Could not reach the backend." Structurally distinct from an HTTP error,
 * which resolves as a normal `RouteResponse` carrying a non-2xx status.
 */
export class TransportError extends Error {
  override readonly name = 'TransportError'
  readonly reason: TransportFailureReason
  readonly command?: string
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly stderr?: string

  constructor(message: string, details: TransportErrorDetails) {
    super(message, { cause: details.cause })
    this.reason = details.reason
    this.command = details.command
    this.exitCode = details.exitCode
    this.signal = details.signal
    this.stderr = details.stderr
  }
}

/**
 * Prefer this over a bare `instanceof` at call sites — it also recognises a
 * `TransportError` that crossed a module-instance boundary.
 */
export function isTransportError(error: unknown): error is TransportError {
  if (error instanceof TransportError) {
    return true
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    (error as { name?: unknown }).name === 'TransportError'
  )
}

/**
 * Reaches the running backend from the lilnas host.
 *
 * `repoPath` is used as the child's `cwd`, never spliced into a shell
 * string — `docker compose exec` has to run from the directory holding the
 * root `docker-compose.yml` (the "always deploy from the root compose file"
 * rule in `CLAUDE.md`), and `cwd` achieves that without a shell.
 */
export function dockerExecTransport(opts: {
  repoPath: string
  /** Compose service to exec into. Defaults to `download`. */
  service?: string
}): Transport {
  const repoPath = opts.repoPath
  const service = opts.service ?? DEFAULT_SERVICE

  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new TypeError(
      'dockerExecTransport: repoPath must be a non-empty path',
    )
  }
  if (!HEADER_NAME.test(service)) {
    throw new TypeError(
      `dockerExecTransport: implausible compose service name: ${service}`,
    )
  }

  return async (path, headers, options = {}) => {
    const requestPath = assertRequestPath(path)
    const bodyMode = options.bodyMode ?? 'json'
    const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    const url = `http://localhost:${NEST_PORT}${requestPath}`

    const args = [
      'compose',
      'exec',
      // Without -T, compose allocates a TTY and mangles the piped output.
      '-T',
      service,
      'curl',
      // Quiet progress, but still surface errors on stderr.
      '-s',
      '-S',
      // Dump the response head to stdout, ahead of the body.
      '-D',
      '-',
      // headers-only: never pull the body across the pipe.
      '-o',
      bodyMode === 'headers-only' ? '/dev/null' : '-',
      '--max-time',
      String(timeoutSeconds),
      // No --fail: a 4xx/5xx body is the evidence we are here to capture.
      ...toCurlHeaderArgs(headers),
      url,
    ]

    const command = `docker ${args.join(' ')}`
    const startedAt = Date.now()
    const result = await runCommand('docker', args, {
      cwd: repoPath,
      timeoutMs: timeoutSeconds * 1000 + SPAWN_GRACE_MS,
    })
    const durationMs = Date.now() - startedAt

    if (result.spawnError) {
      throw new TransportError(
        `Could not run \`docker\` in ${repoPath}: ${describe(result.spawnError)}`,
        {
          reason: 'spawn-failed',
          command,
          stderr: result.stderr,
          cause: result.spawnError,
        },
      )
    }

    if (result.truncated) {
      throw new TransportError(
        `Response for ${requestPath} exceeded ${MAX_STDOUT_BYTES} bytes — ` +
          'this route almost certainly needs bodyMode: "headers-only"',
        { reason: 'output-too-large', command, stderr: result.stderr },
      )
    }

    if (result.timedOut) {
      throw new TransportError(
        `docker compose exec timed out after ${timeoutSeconds}s for ${requestPath}`,
        {
          reason: 'timeout',
          command,
          exitCode: result.code,
          signal: result.signal,
          stderr: result.stderr,
        },
      )
    }

    if (result.code !== 0) {
      const how = result.code === null ? `signal ${result.signal}` : result.code
      throw new TransportError(
        `docker compose exec exited ${how} for ${requestPath}` +
          (result.stderr ? `: ${result.stderr}` : ''),
        {
          reason: 'nonzero-exit',
          command,
          exitCode: result.code,
          signal: result.signal,
          stderr: result.stderr,
        },
      )
    }

    const parsed = splitHeadAndBody(result.stdout.toString('utf8'))

    if (!parsed.head) {
      throw new TransportError(
        `No parseable HTTP response head for ${requestPath}` +
          (result.stderr ? ` (stderr: ${result.stderr})` : ''),
        { reason: 'unparsable-response', command, stderr: result.stderr },
      )
    }

    return {
      status: parsed.head.status,
      headers: parsed.head.headers,
      // headers-only sent the body to /dev/null; there is nothing to return.
      body: bodyMode === 'headers-only' ? '' : parsed.body,
      durationMs,
    }
  }
}

/**
 * Plain-`fetch` transport for local/dev runs against an already-reachable
 * base URL (e.g. `http://localhost:8081`).
 */
export function httpTransport(baseUrl: string): Transport {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new TypeError('httpTransport: baseUrl must be a non-empty URL')
  }
  const root = baseUrl.replace(/\/+$/, '')

  return async (path, headers, options = {}) => {
    const requestPath = assertRequestPath(path)
    const bodyMode = options.bodyMode ?? 'json'
    const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    const url = `${root}${requestPath}`

    for (const [name, value] of Object.entries(headers)) {
      assertHeader(name, value)
    }

    const startedAt = Date.now()
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        // Match curl's default (no -L): report the 307, don't chase it.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      throw new TransportError(
        `${timedOut ? 'Timed out on' : 'Could not reach'} ${url}: ${describe(error)}`,
        {
          reason: timedOut ? 'timeout' : 'network',
          command: url,
          cause: error,
        },
      )
    }

    let body = ''
    if (bodyMode === 'headers-only') {
      // Drop the stream on the floor rather than buffering a whole movie.
      await response.body?.cancel().catch(() => undefined)
    } else {
      try {
        body = await response.text()
      } catch (error) {
        throw new TransportError(
          `Connection dropped while reading ${url}: ${describe(error)}`,
          { reason: 'network', command: url, cause: error },
        )
      }
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
      durationMs: Date.now() - startedAt,
    }
  }
}

interface CommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: Buffer
  stderr: string
  timedOut: boolean
  truncated: boolean
  spawnError?: unknown
}

/**
 * `spawn` with no shell, so nothing in `args` is ever interpreted. Collects
 * stdout under a hard byte ceiling and kills the child on timeout.
 */
function runCommand(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderr = ''
    let timedOut = false
    let truncated = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)

    const finish = (result: CommandResult) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) {
        return
      }
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        truncated = true
        child.kill('SIGKILL')
        return
      }
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk.toString('utf8')
      }
    })

    child.on('error', (error: unknown) => {
      finish({
        code: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks),
        stderr: stderr.trim(),
        timedOut,
        truncated,
        spawnError: error,
      })
    })

    child.on('close', (code, signal) => {
      finish({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr: stderr.trim(),
        timedOut,
        truncated,
      })
    })
  })
}

interface ResponseHead {
  status: number
  headers: Record<string, string>
}

/**
 * `curl -D -` interleaves the response head with the body on stdout, and
 * there can be more than one head: a `100 Continue` or a `307` each emits its
 * own block. Consume blocks while the remaining text still opens with a
 * status line followed by a blank line, and report the *last* one — that is
 * the response the body actually belongs to.
 */
function splitHeadAndBody(raw: string): {
  head: ResponseHead | null
  body: string
} {
  let rest = raw
  let head: ResponseHead | null = null

  while (STATUS_LINE.test(rest)) {
    const boundary = findHeadBoundary(rest)
    if (!boundary) {
      // A status line with no terminating blank line: truncated output.
      break
    }
    const parsed = parseHeadBlock(rest.slice(0, boundary.headEnd))
    if (!parsed) {
      break
    }
    head = parsed
    rest = rest.slice(boundary.bodyStart)
  }

  return { head, body: rest }
}

function findHeadBoundary(
  text: string,
): { headEnd: number; bodyStart: number } | null {
  const crlf = text.indexOf('\r\n\r\n')
  const lf = text.indexOf('\n\n')

  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { headEnd: crlf, bodyStart: crlf + 4 }
  }
  if (lf !== -1) {
    return { headEnd: lf, bodyStart: lf + 2 }
  }
  return null
}

function parseHeadBlock(block: string): ResponseHead | null {
  const lines = block.split(/\r?\n/)
  const statusLine = lines.shift()
  const match = statusLine ? STATUS_LINE.exec(statusLine) : null
  if (!match) {
    return null
  }

  const headers: Record<string, string> = {}
  let lastName: string | null = null

  for (const line of lines) {
    if (line === '') {
      continue
    }
    // Obsolete line folding: a leading space continues the previous value.
    if (/^[ \t]/.test(line) && lastName) {
      headers[lastName] = `${headers[lastName]} ${line.trim()}`
      continue
    }
    const separator = line.indexOf(':')
    if (separator <= 0) {
      continue
    }
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    // Repeated headers (set-cookie, vary) collapse the way fetch does.
    headers[name] = name in headers ? `${headers[name]}, ${value}` : value
    lastName = name
  }

  return { status: Number(match[1]), headers }
}

/**
 * Each header becomes its own `-H name: value` argv entry — never a shell
 * string, so a value can never break out into another curl flag.
 */
function toCurlHeaderArgs(headers: Record<string, string>): string[] {
  const args: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    assertHeader(name, value)
    args.push('-H', `${name}: ${value}`)
  }
  return args
}

function assertHeader(name: string, value: string): void {
  if (!HEADER_NAME.test(name)) {
    throw new TypeError(`Invalid request header name: ${JSON.stringify(name)}`)
  }
  if (typeof value !== 'string' || CONTROL_CHARS.test(value)) {
    throw new TypeError(`Invalid request header value for ${name}`)
  }
}

/**
 * Paths come from the route manifest, but validate anyway: ids mined out of a
 * live response end up in here, and neither curl nor a URL should ever see
 * whitespace or a control character.
 */
function assertRequestPath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`Request path must start with "/": ${String(path)}`)
  }
  if (/\s/.test(path) || CONTROL_CHARS.test(path)) {
    throw new TypeError(
      'Request path contains whitespace or control characters: ' +
        JSON.stringify(path),
    )
  }
  return path
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
