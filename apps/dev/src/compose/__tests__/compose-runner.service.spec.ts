import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Logger } from '@nestjs/common'
import { lastValueFrom, toArray } from 'rxjs'

import {
  ACTION_ARGS,
  Operation,
  OperationNotFoundError,
  OpEvent,
  PreflightError,
  RunnableStack,
  StackAction,
  StackBusyError,
} from 'src/compose/compose.types'
import {
  ComposeRunnerService,
  MAX_LINES,
  MAX_OPERATIONS,
  OPERATION_TIMEOUT_MS,
} from 'src/compose/compose-runner.service'

// Records argv (one per line) and $PWD, prints $STUB_LINES (`out:` or `err:`
// prefixed, one per line, with a pause so the two pipes stay ordered), then
// exits with $STUB_EXIT. STUB_HANG replaces the shell with a long sleep.
const STUB = `#!/bin/sh
{
  printf 'pwd=%s\\n' "$PWD"
  for arg in "$@"; do printf 'arg=%s\\n' "$arg"; done
  printf 'ansi=%s hints=%s\\n' "$COMPOSE_ANSI" "$DOCKER_CLI_HINTS"
} > "$STUB_RECORD"
if [ -n "$STUB_HANG" ]; then exec sleep 60; fi
printf '%s\\n' "$STUB_LINES" | while IFS= read -r line; do
  case "$line" in
    out:*) printf '%s\\n' "\${line#out:}" ;;
    err:*) printf '%s\\n' "\${line#err:}" >&2 ;;
  esac
  sleep 0.05
done
exit "\${STUB_EXIT:-0}"
`

const lilnasStack: RunnableStack = {
  id: 'lilnas-dev:download',
  composeArgs: [
    '-p',
    'lilnas-dev',
    '-f',
    'apps/download/deploy.dev.yml',
    '--project-directory',
    '/repo',
  ],
  projectDir: '/tmp',
  envFiles: [
    { path: '/repo/apps/download/.env', required: true, exists: true },
  ],
}

const devStack: RunnableStack = {
  id: 'dev:hop-road',
  composeArgs: ['-f', 'docker-compose.dev.yml'],
  projectDir: '/tmp',
  envFiles: [],
}

describe('ComposeRunnerService', () => {
  let dir: string
  let record: string
  let service: ComposeRunnerService

  const done = (operation: Operation) =>
    lastValueFrom(service.stream(operation.id).pipe(toArray()))

  const recorded = () => {
    const lines = readFileSync(record, 'utf8').trim().split('\n')
    return {
      pwd: lines.find(l => l.startsWith('pwd='))?.slice(4),
      args: lines.filter(l => l.startsWith('arg=')).map(l => l.slice(4)),
      env: lines.find(l => l.startsWith('ansi=')),
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'compose-runner-'))
    record = join(dir, 'record')
    const bin = join(dir, 'docker')
    writeFileSync(bin, STUB)
    chmodSync(bin, 0o755)
    process.env.DOCKER_BIN = bin
    process.env.STUB_RECORD = record
    delete process.env.STUB_LINES
    delete process.env.STUB_EXIT
    delete process.env.STUB_HANG
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    service = new ComposeRunnerService()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.DOCKER_BIN
    delete process.env.STUB_RECORD
    delete process.env.STUB_LINES
    delete process.env.STUB_EXIT
    delete process.env.STUB_HANG
    rmSync(dir, { recursive: true, force: true })
  })

  describe.each<[string, RunnableStack]>([
    ['lilnas-style', lilnasStack],
    ['dev-style', devStack],
  ])('argv and cwd (%s composeArgs)', (_label, stack) => {
    it.each(Object.keys(ACTION_ARGS) as StackAction[])(
      'runs docker compose for %s',
      async action => {
        const operation = service.start(stack, action, 'jeremy')
        await done(operation)

        expect(recorded()).toEqual({
          pwd: '/tmp',
          args: ['compose', ...stack.composeArgs, ...ACTION_ARGS[action]],
          env: 'ansi=never hints=false',
        })
        expect(operation.command).toEqual([
          process.env.DOCKER_BIN,
          'compose',
          ...stack.composeArgs,
          ...ACTION_ARGS[action],
        ])
        expect(operation.actor).toBe('jeremy')
      },
    )
  })

  it('never passes --volumes or --remove-orphans', () => {
    for (const args of Object.values(ACTION_ARGS)) {
      expect(args).not.toContain('--volumes')
      expect(args).not.toContain('--remove-orphans')
      expect(args).not.toContain('-v')
    }
  })

  it('captures stdout and stderr in order with stream tags', async () => {
    process.env.STUB_LINES = 'out:one\nerr:two\nout:three\nerr:four'
    const operation = service.start(devStack, 'up')
    await done(operation)

    expect(operation.lines.map(l => [l.stream, l.text])).toEqual([
      ['stdout', 'one'],
      ['stderr', 'two'],
      ['stdout', 'three'],
      ['stderr', 'four'],
    ])
    expect(Date.parse(operation.lines.at(0)?.ts ?? '')).not.toBeNaN()
  })

  it('marks exit 0 as succeeded', async () => {
    const operation = service.start(devStack, 'up')
    expect(operation.status).toBe('running')
    await done(operation)

    expect(operation.status).toBe('succeeded')
    expect(operation.exitCode).toBe(0)
    expect(operation.finishedAt).toBeDefined()
  })

  it('marks exit 2 as failed with its exit code', async () => {
    process.env.STUB_EXIT = '2'
    const operation = service.start(devStack, 'up')
    await done(operation)

    expect(operation.status).toBe('failed')
    expect(operation.exitCode).toBe(2)
  })

  it('fails the operation when the binary cannot be spawned', async () => {
    process.env.DOCKER_BIN = join(dir, 'missing')
    const operation = service.start(devStack, 'up')
    await done(operation)

    expect(operation.status).toBe('failed')
    expect(operation.exitCode).toBeUndefined()
    expect(operation.lines.at(0)?.text).toMatch(/Failed to run/)
  })

  it('rejects a second start while one is running, then allows it again', async () => {
    process.env.STUB_LINES = 'out:slow'
    const first = service.start(devStack, 'up')

    expect(service.runningFor(devStack.id)).toBe(first)
    expect(() => service.start(devStack, 'restart')).toThrow(StackBusyError)
    // A different stack is not blocked.
    const other = service.start(lilnasStack, 'stop')
    await done(other)

    await done(first)
    expect(service.runningFor(devStack.id)).toBeUndefined()
    const second = service.start(devStack, 'stop')
    expect(second.id).not.toBe(first.id)
    await done(second)
  })

  it('replays lines to a late subscriber and completes with done', async () => {
    process.env.STUB_LINES = 'out:a\nerr:b'
    const operation = service.start(devStack, 'up')
    await done(operation)

    const events = await lastValueFrom(
      service.stream(operation.id).pipe(toArray()),
    )
    expect(events.map(e => (e.type === 'line' ? e.line.text : e.type))).toEqual(
      ['a', 'b', 'done'],
    )
    const last = events[events.length - 1] as Extract<OpEvent, { type: 'done' }>
    expect(last.operation.status).toBe('succeeded')
  })

  it('replays earlier lines and then follows live ones', async () => {
    process.env.STUB_LINES = 'out:a\nout:b\nout:c'
    const operation = service.start(devStack, 'up')
    await new Promise(resolve => setTimeout(resolve, 90))

    const events = await lastValueFrom(
      service.stream(operation.id).pipe(toArray()),
    )
    expect(events.map(e => (e.type === 'line' ? e.line.text : e.type))).toEqual(
      ['a', 'b', 'c', 'done'],
    )
  })

  it('errors the stream for an unknown operation', async () => {
    await expect(
      lastValueFrom(service.stream('nope').pipe(toArray())),
    ).rejects.toThrow(OperationNotFoundError)
    expect(service.get('nope')).toBeUndefined()
  })

  describe('preflight', () => {
    const stack: RunnableStack = {
      ...devStack,
      envFiles: [
        { path: '/p/.env', required: true, exists: false },
        { path: '/p/.env.optional', required: false, exists: false },
        { path: '/p/.env.ok', required: true, exists: true },
      ],
    }

    it('lists only missing required env files', () => {
      expect(service.preflight(stack)).toEqual({
        ok: false,
        missing: ['/p/.env'],
      })
      expect(service.preflight(devStack)).toEqual({ ok: true, missing: [] })
    })

    it.each<StackAction>(['up', 'recreate', 'restart'])(
      'blocks %s with PreflightError',
      action => {
        let error: unknown
        try {
          service.start(stack, action)
        } catch (e) {
          error = e
        }
        expect(error).toBeInstanceOf(PreflightError)
        expect((error as PreflightError).missing).toEqual(['/p/.env'])
        expect(service.runningFor(stack.id)).toBeUndefined()
      },
    )

    it.each<StackAction>(['stop', 'down'])(
      'skips preflight for %s',
      async action => {
        const operation = service.start(stack, action)
        await done(operation)
        expect(operation.status).toBe('succeeded')
      },
    )
  })

  it('caps lines at 2000, dropping the oldest and noting it', async () => {
    const count = MAX_LINES + 50
    // The stub sleeps per line; swap in a fast one for the flood.
    const fast = join(dir, 'fast-docker')
    writeFileSync(
      fast,
      `#!/bin/sh\nseq 0 ${count - 1} | while read i; do echo "line-$i"; done\n`,
    )
    chmodSync(fast, 0o755)
    process.env.DOCKER_BIN = fast

    const operation = service.start(devStack, 'up')
    await done(operation)

    expect(operation.lines).toHaveLength(MAX_LINES)
    expect(operation.lines.at(0)?.text).toMatch(/earlier lines dropped/)
    expect(operation.lines.at(-1)?.text).toBe(`line-${count - 1}`)
    const dropped = Number(
      /(\d+) earlier/.exec(operation.lines.at(0)?.text ?? '')?.[1],
    )
    expect(operation.lines.at(1)?.text).toBe(`line-${dropped}`)
    expect(dropped + MAX_LINES - 1).toBe(count)
  })

  it('keeps only the last 50 operations', async () => {
    const ids: string[] = []
    for (let i = 0; i < MAX_OPERATIONS + 5; i++) {
      const operation = service.start({ ...devStack, id: `stack-${i}` }, 'stop')
      ids.push(operation.id)
      await done(operation)
    }

    expect(service.get(ids.at(0) ?? '')).toBeUndefined()
    expect(service.get(ids.at(4) ?? '')).toBeUndefined()
    expect(service.get(ids.at(5) ?? '')).toBeDefined()
    expect(service.get(ids.at(ids.length - 1) ?? '')).toBeDefined()
  })

  it('sends SIGTERM after the timeout and marks the operation failed', async () => {
    process.env.STUB_HANG = '1'
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const operation = service.start(devStack, 'up')
    const finished = done(operation)

    jest.advanceTimersByTime(OPERATION_TIMEOUT_MS)
    await finished

    expect(operation.status).toBe('failed')
    expect(operation.exitCode).toBeUndefined()
    expect(operation.lines.some(l => /Timed out/.test(l.text))).toBe(true)
  })
})
