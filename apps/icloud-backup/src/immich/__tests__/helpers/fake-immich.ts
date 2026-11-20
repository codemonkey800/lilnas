import { randomUUID } from 'node:crypto'
import { createServer, IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export const API_KEY = 'test-api-key-0123456789'

/** The single element of a list, or a failure that says so. */
export function only<T>(items: readonly T[]): T {
  const [item] = items
  if (items.length !== 1 || item === undefined) {
    throw new Error(`expected exactly one item, got ${items.length}`)
  }
  return item
}

export interface RecordedRequest {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: unknown
}

export interface FakeUser {
  id: string
  email: string
  name: string
  password?: string
}

export interface FakeLibrary {
  id: string
  ownerId: string
  name: string
  importPaths: string[]
}

/** A tiny in-memory stand-in for the Immich admin routes T7 uses. */
export class FakeImmich {
  readonly users: FakeUser[] = []
  readonly libraries: FakeLibrary[] = []
  readonly requests: RecordedRequest[] = []
  readonly scans: string[] = []
  /** When set, every request waits this long before answering. */
  delayMs = 0

  private server: Server = createServer((req, res) => {
    void this.handle(req, res)
  })
  url = ''

  async start(): Promise<void> {
    await new Promise<void>(resolve =>
      this.server.listen(0, '127.0.0.1', resolve),
    )
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  reset(): void {
    this.users.length = 0
    this.libraries.length = 0
    this.requests.length = 0
    this.scans.length = 0
    this.delayMs = 0
  }

  calls(method: string, path: string): RecordedRequest[] {
    return this.requests.filter(r => r.method === method && r.path === path)
  }

  private async handle(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body: unknown = raw ? JSON.parse(raw) : undefined
    const method = req.method ?? ''
    const path = req.url ?? ''
    this.requests.push({ method, path, headers: req.headers, body })

    if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs))

    const send = (status: number, payload?: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(payload === undefined ? undefined : JSON.stringify(payload))
    }
    const fail = (status: number, message: string | string[]): void =>
      send(status, { message, error: 'Error', statusCode: status })

    if (req.headers['x-api-key'] !== API_KEY) {
      return fail(401, 'Invalid API key')
    }

    const input = (body ?? {}) as Record<string, unknown>
    const userMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(path)
    const libMatch = /^\/api\/libraries\/([^/]+)\/(scan|statistics)$/.exec(path)

    if (method === 'GET' && path === '/api/admin/users') {
      return send(
        200,
        this.users.map(({ id, email, name }) => ({ id, email, name })),
      )
    }
    if (method === 'POST' && path === '/api/admin/users') {
      const email = String(input.email)
      if (this.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        return fail(400, 'User exists')
      }
      const user: FakeUser = {
        id: randomUUID(),
        email,
        name: String(input.name),
        password: String(input.password),
      }
      this.users.push(user)
      return send(201, { id: user.id, email: user.email, name: user.name })
    }
    if (method === 'PUT' && userMatch) {
      const user = this.users.find(u => u.id === userMatch[1])
      if (!user) return fail(404, 'User not found')
      user.password = String(input.password)
      return send(200, { id: user.id, email: user.email, name: user.name })
    }
    if (method === 'GET' && path === '/api/libraries') {
      return send(200, this.libraries)
    }
    if (method === 'POST' && path === '/api/libraries') {
      const ownerId = String(input.ownerId)
      if (!this.users.some(u => u.id === ownerId)) {
        return fail(400, ['ownerId must be a UUID'])
      }
      const library: FakeLibrary = {
        id: randomUUID(),
        ownerId,
        name: String(input.name),
        importPaths: input.importPaths as string[],
      }
      this.libraries.push(library)
      return send(201, library)
    }
    if (method === 'POST' && libMatch?.[2] === 'scan') {
      this.scans.push(String(libMatch[1]))
      return send(204)
    }
    return fail(404, `Cannot ${method} ${path}`)
  }
}
