import type { INestApplication, MessageEvent } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'net'

import { HostActivityService } from 'src/activity/host-activity.service'
import type { OpEvent } from 'src/compose/compose.types'
import { ComposeRunnerService } from 'src/compose/compose-runner.service'
import { DockerEngineService } from 'src/docker/docker-engine.service'
import { RegistryService } from 'src/registry/registry.service'
import {
  composeLabels,
  container,
  dockerEvent,
  FakeActivity,
  FakeDocker,
  FakeRegistry,
  FakeRunner,
  operation,
  service,
  stack,
} from 'src/stacks/__tests__/helpers/fakes'
import { KEEPALIVE_MS, StacksController } from 'src/stacks/stacks.controller'
import { EVENT_DEBOUNCE_MS, StacksService } from 'src/stacks/stacks.service'

const STACK_ID = 'dev:app:docker-compose.yml'

interface Frame {
  id?: string
  event?: string
  data: string
}

function parseFrames(body: string): Frame[] {
  return body
    .split('\n\n')
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const frame: Frame = { data: '' }
      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) frame.id = line.slice(4)
        else if (line.startsWith('event: ')) frame.event = line.slice(7)
        else if (line.startsWith('data: ')) frame.data += line.slice(6)
      }
      return frame
    })
}

async function setup() {
  const docker = new FakeDocker()
  const registry = new FakeRegistry()
  const runner = new FakeRunner()
  const activity = new FakeActivity()
  registry.stacks = [
    stack(STACK_ID, 'app', [service('web')], {
      envFiles: [{ path: '/dev/app/.env', required: true, exists: true }],
    }),
  ]
  const moduleRef = await Test.createTestingModule({
    controllers: [StacksController],
    providers: [
      StacksService,
      { provide: DockerEngineService, useValue: docker },
      { provide: RegistryService, useValue: registry },
      { provide: ComposeRunnerService, useValue: runner },
      { provide: HostActivityService, useValue: activity },
    ],
  }).compile()
  return { docker, registry, runner, activity, moduleRef }
}

describe('StacksController', () => {
  let app: INestApplication | undefined
  let base = ''
  let ctx: Awaited<ReturnType<typeof setup>>

  beforeEach(async () => {
    ctx = await setup()
    app = ctx.moduleRef.createNestApplication()
    await app.listen(0, '127.0.0.1')
    const { port } = app.getHttpServer().address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    jest.useRealTimers()
    await app?.close()
    app = undefined
  })

  const post = (id: string, action: string, headers: HeadersInit = {}) =>
    fetch(
      `${base}/stacks/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
      { method: 'POST', headers },
    )

  describe('GET /stacks', () => {
    it('returns the overview', async () => {
      ctx.docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
      ]

      const res = await fetch(`${base}/stacks`)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.stacks).toHaveLength(1)
      expect(body.stacks[0]).toMatchObject({ id: STACK_ID, state: 'running' })
      expect(body.host.containers).toBe(1)
    })
  })

  describe('GET /stacks/:id', () => {
    it('returns one stack, with ids that contain colons', async () => {
      const res = await fetch(`${base}/stacks/${encodeURIComponent(STACK_ID)}`)

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id: STACK_ID, state: 'absent' })
    })

    it('404s for an unknown stack', async () => {
      const res = await fetch(`${base}/stacks/nope`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /stacks/:id/actions/:action', () => {
    it('202s with the operation and forwards x-forwarded-user as actor', async () => {
      const res = await post(STACK_ID, 'up', {
        'x-forwarded-user': 'jeremy@example.com',
      })
      const body = await res.json()

      expect(res.status).toBe(202)
      expect(body.operation).toMatchObject({
        stackId: STACK_ID,
        action: 'up',
        actor: 'jeremy@example.com',
      })
      expect(ctx.runner.startCalls).toHaveLength(1)
      expect(ctx.runner.startCalls[0]).toMatchObject({
        action: 'up',
        actor: 'jeremy@example.com',
      })
    })

    it('leaves the actor undefined without the header', async () => {
      const res = await post(STACK_ID, 'stop')

      expect(res.status).toBe(202)
      expect(ctx.runner.startCalls[0]?.actor).toBeUndefined()
    })

    it.each(['rm', 'toString', '__proto__', 'UP'])(
      '400s for the unknown action %s without touching the runner',
      async action => {
        const res = await post(STACK_ID, action)

        expect(res.status).toBe(400)
        expect(ctx.runner.startCalls).toEqual([])
      },
    )

    it('404s for an unknown stack without touching the runner', async () => {
      const res = await post('lilnas:ghost', 'up')

      expect(res.status).toBe(404)
      expect(ctx.runner.startCalls).toEqual([])
    })

    it('409s with the running operation when the stack is busy', async () => {
      const running = operation(STACK_ID, { id: 'op-running' })
      ctx.runner.operations.set(running.id, running)

      const res = await post(STACK_ID, 'restart')
      const body = await res.json()

      expect(res.status).toBe(409)
      expect(body.operation).toMatchObject({ id: 'op-running' })
    })

    it('412s with the missing env files', async () => {
      ctx.runner.missing = ['/dev/app/.env']

      const res = await post(STACK_ID, 'up')

      expect(res.status).toBe(412)
      expect(await res.json()).toEqual({ missing: ['/dev/app/.env'] })
    })
  })

  describe('operations', () => {
    it('GET /operations/:opId returns the operation', async () => {
      const op = operation(STACK_ID)
      ctx.runner.operations.set(op.id, op)

      const res = await fetch(`${base}/operations/${op.id}`)

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id: op.id, stackId: STACK_ID })
    })

    it('GET /operations/:opId 404s when unknown', async () => {
      const res = await fetch(`${base}/operations/ghost`)

      expect(res.status).toBe(404)
    })

    it('streams OpEvents with ids from 0 and ends after done', async () => {
      const op = operation(STACK_ID, { status: 'succeeded', exitCode: 0 })
      ctx.runner.operations.set(op.id, op)
      const line = { stream: 'stdout' as const, text: 'hi', ts: 't' }
      ctx.runner.events = [
        { type: 'line', line },
        { type: 'line', line },
        { type: 'done', operation: op },
      ]

      const res = await fetch(`${base}/operations/${op.id}/stream`)
      const frames = parseFrames(await res.text())

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(frames.map(f => f.id)).toEqual(['0', '1', '2'])
      const events = frames.map(f => JSON.parse(f.data) as OpEvent)
      expect(events.map(e => e.type)).toEqual(['line', 'line', 'done'])
    })

    it('404s the stream for an unknown operation', async () => {
      const res = await fetch(`${base}/operations/ghost/stream`)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /containers/:name/logs', () => {
    const logs = (name: string, query = '') =>
      fetch(`${base}/containers/${encodeURIComponent(name)}/logs${query}`)

    it('streams LogLines with ids from 0, following the container', async () => {
      const res = await logs('app-web-1')
      const frames = parseFrames(await res.text())

      expect(res.status).toBe(200)
      expect(frames.map(f => f.id)).toEqual(['0', '1'])
      expect(JSON.parse(frames[1]?.data ?? '')).toEqual({
        stream: 'stderr',
        text: 'two',
      })
      expect(ctx.docker.logCalls).toEqual([
        {
          id: 'app-web-1',
          opts: { tail: 200, timestamps: false, follow: true },
        },
      ])
    })

    it('404s for a container that is not part of a discovered stack', async () => {
      const res = await logs('lilnas-auth')

      expect(res.status).toBe(404)
      expect(ctx.docker.logCalls).toEqual([])
    })

    it.each([
      ['100', 100],
      ['0', 1],
      ['-5', 1],
      ['5000', 5000],
      ['99999', 5000],
      ['abc', 200],
      ['', 200],
    ])('clamps tail=%s to %d', async (raw, expected) => {
      const res = await logs('app-web-1', `?tail=${raw}`)
      await res.text()

      expect(ctx.docker.logCalls[0]?.opts.tail).toBe(expected)
    })

    it('passes timestamps=1 through', async () => {
      const res = await logs('app-web-1', '?timestamps=1')
      await res.text()

      expect(ctx.docker.logCalls[0]?.opts.timestamps).toBe(true)
    })
  })

  describe('GET /events', () => {
    function subscribe() {
      const controller = ctx.moduleRef.get(StacksController)
      const messages: MessageEvent[] = []
      const sub = controller.events().subscribe(m => messages.push(m))
      return { messages, sub }
    }

    it('emits debounced stacks-changed events and keepalives with ids from 0', async () => {
      jest.useFakeTimers()
      const { messages, sub } = subscribe()

      ctx.docker.events$.next(dockerEvent('app'))
      ctx.docker.events$.next(dockerEvent('app'))
      ctx.docker.events$.next(dockerEvent('unrelated'))
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS)
      await jest.advanceTimersByTimeAsync(KEEPALIVE_MS)

      expect(messages).toEqual([
        {
          id: '0',
          data: { type: 'stacks-changed', stackIds: [STACK_ID] },
        },
        { id: '1', data: { type: 'keepalive' } },
      ])
      sub.unsubscribe()
    })

    it('keeps sending keepalives with incrementing ids', async () => {
      jest.useFakeTimers()
      const { messages, sub } = subscribe()

      await jest.advanceTimersByTimeAsync(KEEPALIVE_MS * 3)

      expect(messages.map(m => m.id)).toEqual(['0', '1', '2'])
      sub.unsubscribe()
    })

    it('starts ids over for each connection', async () => {
      jest.useFakeTimers()
      const first = subscribe()
      await jest.advanceTimersByTimeAsync(KEEPALIVE_MS)
      const second = subscribe()
      await jest.advanceTimersByTimeAsync(KEEPALIVE_MS)

      expect(first.messages.map(m => m.id)).toEqual(['0', '1'])
      expect(second.messages.map(m => m.id)).toEqual(['0'])
      first.sub.unsubscribe()
      second.sub.unsubscribe()
    })

    it('serves text/event-stream over HTTP', async () => {
      const abort = new AbortController()
      const res = await fetch(`${base}/events`, { signal: abort.signal })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      abort.abort()
    })
  })
})
