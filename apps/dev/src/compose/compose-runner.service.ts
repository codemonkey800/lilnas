import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { env } from '@lilnas/utils/env'
import { Injectable, Logger } from '@nestjs/common'
import { Observable, Subject, throwError } from 'rxjs'

import {
  ACTION_ARGS,
  Operation,
  OperationNotFoundError,
  OpEvent,
  OpLine,
  Preflight,
  PREFLIGHT_ACTIONS,
  PreflightError,
  RunnableStack,
  StackAction,
  StackBusyError,
} from 'src/compose/compose.types'
import { EnvKeys } from 'src/env'

export const MAX_OPERATIONS = 50
export const MAX_LINES = 2000
export const OPERATION_TIMEOUT_MS = 15 * 60 * 1000

interface Tracked {
  operation: Operation
  events: Subject<OpEvent>
  // Lines evicted from the head of operation.lines.
  dropped: number
}

@Injectable()
export class ComposeRunnerService {
  private readonly logger = new Logger(ComposeRunnerService.name)
  // Insertion-ordered, so the first entries are the oldest operations.
  private readonly operations = new Map<string, Tracked>()

  preflight(stack: RunnableStack): Preflight {
    const missing = stack.envFiles
      .filter(file => file.required && !file.exists)
      .map(file => file.path)
    return { ok: missing.length === 0, missing }
  }

  // Returns the live operation: its status and lines update as it runs.
  start(stack: RunnableStack, action: StackAction, actor?: string): Operation {
    const running = this.runningFor(stack.id)
    if (running) throw new StackBusyError(stack.id, running.id)

    if (PREFLIGHT_ACTIONS.includes(action)) {
      const { ok, missing } = this.preflight(stack)
      if (!ok) throw new PreflightError(missing)
    }

    const bin = env(EnvKeys.DOCKER_BIN, 'docker')
    const args = ['compose', ...stack.composeArgs, ...ACTION_ARGS[action]]
    const operation: Operation = {
      id: randomUUID(),
      stackId: stack.id,
      action,
      actor,
      status: 'running',
      startedAt: new Date().toISOString(),
      command: [bin, ...args],
      lines: [],
    }
    const tracked: Tracked = {
      operation,
      events: new Subject<OpEvent>(),
      dropped: 0,
    }
    this.operations.set(operation.id, tracked)
    this.evict()

    this.logger.log({
      msg: 'compose operation started',
      operationId: operation.id,
      stackId: stack.id,
      action,
      actor,
    })

    this.run(tracked, bin, args, stack.projectDir)
    return operation
  }

  get(opId: string): Operation | undefined {
    return this.operations.get(opId)?.operation
  }

  runningFor(stackId: string): Operation | undefined {
    for (const { operation } of this.operations.values()) {
      if (operation.stackId === stackId && operation.status === 'running') {
        return operation
      }
    }
    return undefined
  }

  // Replays the lines captured so far, then follows live; completes after
  // the 'done' event. Replay and subscription happen in the same tick, so no
  // line can fall between them.
  stream(opId: string): Observable<OpEvent> {
    const tracked = this.operations.get(opId)
    if (!tracked) return throwError(() => new OperationNotFoundError(opId))

    return new Observable<OpEvent>(subscriber => {
      const { operation, events } = tracked
      for (const line of [...operation.lines]) {
        subscriber.next({ type: 'line', line })
      }
      if (operation.status !== 'running') {
        subscriber.next({ type: 'done', operation })
        subscriber.complete()
        return undefined
      }
      const subscription = events.subscribe(subscriber)
      return () => subscription.unsubscribe()
    })
  }

  private run(tracked: Tracked, bin: string, args: string[], cwd: string) {
    const { operation } = tracked
    let finished = false
    let timedOut = false

    const finish = (exitCode: number | undefined) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      operation.exitCode = exitCode
      operation.status = exitCode === 0 ? 'succeeded' : 'failed'
      operation.finishedAt = new Date().toISOString()
      this.logger.log({
        msg: 'compose operation finished',
        operationId: operation.id,
        stackId: operation.stackId,
        action: operation.action,
        actor: operation.actor,
        status: operation.status,
        exitCode,
      })
      tracked.events.next({ type: 'done', operation })
      tracked.events.complete()
    }

    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, COMPOSE_ANSI: 'never', DOCKER_CLI_HINTS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      timedOut = true
      this.addLine(
        tracked,
        'stderr',
        `Timed out after ${OPERATION_TIMEOUT_MS / 60000} minutes; sent SIGTERM`,
      )
      child.kill('SIGTERM')
    }, OPERATION_TIMEOUT_MS)
    timer.unref()

    const buffers = { stdout: '', stderr: '' }
    const attach = (stream: 'stdout' | 'stderr') => {
      child[stream].setEncoding('utf8')
      child[stream].on('data', (chunk: string) => {
        const parts = (buffers[stream] + chunk).split(/\r?\n/)
        buffers[stream] = parts.pop() ?? ''
        for (const text of parts) this.addLine(tracked, stream, text)
      })
    }
    attach('stdout')
    attach('stderr')

    child.on('error', error => {
      this.addLine(tracked, 'stderr', `Failed to run ${bin}: ${error.message}`)
      finish(undefined)
    })

    // 'close' fires after the stdio streams end, so every line is captured.
    child.on('close', (code, signal) => {
      for (const stream of ['stdout', 'stderr'] as const) {
        if (buffers[stream]) this.addLine(tracked, stream, buffers[stream])
        buffers[stream] = ''
      }
      if (signal && !timedOut) {
        this.addLine(tracked, 'stderr', `Terminated by ${signal}`)
      }
      // A killed child has no exit code, so a timeout ends as failed without one.
      finish(code ?? undefined)
    })
  }

  private addLine(
    tracked: Tracked,
    stream: OpLine['stream'],
    text: string,
  ): void {
    const { operation } = tracked
    const line: OpLine = { stream, text, ts: new Date().toISOString() }
    operation.lines.push(line)
    tracked.events.next({ type: 'line', line })

    // The cap includes the drop note, which always sits at index 0. Creating
    // the note costs one extra slot, so the first overflow drops two lines.
    if (operation.lines.length > MAX_LINES) {
      const hasNote = tracked.dropped > 0
      const removed = hasNote ? 1 : 2
      operation.lines.splice(hasNote ? 1 : 0, removed)
      tracked.dropped += removed
      const note: OpLine = {
        stream: 'stderr',
        text: `… ${tracked.dropped} earlier lines dropped`,
        ts: operation.lines.at(0)?.ts ?? line.ts,
      }
      if (hasNote) operation.lines[0] = note
      else operation.lines.unshift(note)
    }
  }

  private evict(): void {
    for (const [id, { operation }] of this.operations) {
      if (this.operations.size <= MAX_OPERATIONS) return
      if (operation.status !== 'running') this.operations.delete(id)
    }
  }
}
