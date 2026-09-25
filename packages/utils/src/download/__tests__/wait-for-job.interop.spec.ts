// Every other `waitForJob` test (see `client.spec.ts`) fakes the `WebSocket`
// constructor entirely, which proves the client's own state machine but
// nothing about whether it actually speaks the same protocol as the real
// gateway. This spec is the one place that closes that gap: it stands up a
// real `ws` `WebSocketServer` - the same library
// `apps/download/src/download-gateway/download.gateway.ts` runs on via
// `@nestjs/platform-ws` - and drives `waitForJob` against it over a real loopback
// socket.
//
// This relies on the global `WebSocket` (undici's, via Node's `fetch`
// implementation), which needs Node >= 22. The production runtime image is
// `node:25.0.0-slim` (see `apps/download/Dockerfile`) and local dev runs
// Node 24, so both floors clear it comfortably - this is not a concern for CI,
// only a note for whoever runs this file on an older Node by hand.
import type { IncomingHttpHeaders } from 'http'
import type { AddressInfo } from 'net'
import { WebSocket as WsWebSocket, WebSocketServer } from 'ws'

import { DownloadClient } from 'src/download/client'
import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJob,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
  Media,
} from 'src/download/types'

const VIDEO_MEDIA: Media = {
  downloadUrls: ['https://example.com/a.mp4'],
  id: 'video:v1',
  overview: 'a video',
  sourceUrl: 'https://example.com/video',
  timeRange: { start: '00:00:00', end: '00:01:00' },
  title: 'A video',
  type: DownloadType.Video,
}

function buildJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: VIDEO_MEDIA,
    requester: null,
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

// What the reconcile `GET /download/videos/:id` (fired on every socket open)
// answers with - deliberately non-terminal, so a passing test proves the
// gateway *frame* resolved `waitForJob`, not the reconcile call racing it.
const NON_TERMINAL_JOB = buildJob({ status: DownloadJobStatus.Downloading })
const TERMINAL_JOB = buildJob({ status: DownloadJobStatus.Completed })

function mockReconcileFetch(): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(NON_TERMINAL_JOB),
  } as unknown as Response)
}

function sendJobEvent(
  socket: WsWebSocket,
  job: DownloadJob,
  type: DownloadJobEventType = DownloadJobEventType.Updated,
): void {
  socket.send(
    JSON.stringify({ type: DOWNLOAD_JOB_EVENT_TYPE, data: { job, type } }),
  )
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const client of server.clients) client.terminate()
    server.close(error => (error ? reject(error) : resolve()))
  })
}

describe('DownloadClient.waitForJob (real ws server interop)', () => {
  let server: WebSocketServer | undefined

  afterEach(async () => {
    if (server) {
      await closeServer(server)
      server = undefined
    }
  })

  it('carries the forwarded identity headers on the WS upgrade, and resolves from a real gateway frame', async () => {
    mockReconcileFetch()

    server = new WebSocketServer({ port: 0 })
    const port = (server.address() as AddressInfo).port
    const client = new DownloadClient(
      `http://127.0.0.1:${port}`,
    ).withForwardedIdentity({ email: 'probe@example.com', userId: 'u1' })

    let capturedHeaders: IncomingHttpHeaders | undefined

    server.on('connection', (socket, request) => {
      capturedHeaders = request.headers
      sendJobEvent(socket, TERMINAL_JOB)
    })

    const job = await client.waitForJob('job-1')

    expect(job).toEqual(TERMINAL_JOB)
    expect(capturedHeaders?.['x-forwarded-user']).toBe('probe@example.com')
    expect(capturedHeaders?.['x-forwarded-user-id']).toBe('u1')
  })

  it('reconnects after the server drops the socket, and resolves from the reconnected one', async () => {
    mockReconcileFetch()

    server = new WebSocketServer({ port: 0 })
    const port = (server.address() as AddressInfo).port
    const client = new DownloadClient(
      `http://127.0.0.1:${port}`,
    ).withForwardedIdentity({ email: 'probe@example.com', userId: 'u1' })

    const connections: WsWebSocket[] = []

    server.on('connection', socket => {
      connections.push(socket)

      if (connections.length === 1) {
        // Drop the first connection from the server side, forcing the
        // client onto its real ~1s-first-rung reconnect ladder - no fake
        // timers here, this is the one test that proves that ladder
        // actually reconnects against a live socket.
        socket.close()
        return
      }

      sendJobEvent(socket, TERMINAL_JOB)
    })

    const job = await client.waitForJob('job-1')

    expect(job).toEqual(TERMINAL_JOB)
    expect(connections).toHaveLength(2)
  }, 15_000)
})
