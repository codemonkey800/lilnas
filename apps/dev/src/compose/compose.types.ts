export type StackAction = 'up' | 'stop' | 'restart' | 'down' | 'recreate'

// `down` never gets --volumes or --remove-orphans: the dashboard must not be
// able to delete data or containers it did not start.
export const ACTION_ARGS: Record<StackAction, string[]> = {
  up: ['up', '-d'],
  stop: ['stop'],
  restart: ['restart'],
  down: ['down'],
  recreate: ['up', '-d', '--force-recreate'],
}

// Actions that (re)start containers and so need their required env files.
export const PREFLIGHT_ACTIONS: readonly StackAction[] = [
  'up',
  'recreate',
  'restart',
]

export interface OpLine {
  stream: 'stdout' | 'stderr'
  text: string
  ts: string
}

export interface Operation {
  id: string
  stackId: string
  action: StackAction
  actor?: string
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt?: string
  exitCode?: number
  command: string[]
  lines: OpLine[]
}

export type OpEvent =
  { type: 'line'; line: OpLine } | { type: 'done'; operation: Operation }

export interface Preflight {
  ok: boolean
  // Paths of required env files that do not exist.
  missing: string[]
}

// The slice of the registry's stack shape the runner needs. The runner never
// reads compose files itself.
export interface RunnableStack {
  id: string
  composeArgs: string[]
  projectDir: string
  envFiles: { path: string; required: boolean; exists: boolean }[]
}

export class StackBusyError extends Error {
  constructor(
    readonly stackId: string,
    readonly operationId: string,
  ) {
    super(`Stack ${stackId} already has a running operation (${operationId})`)
    this.name = 'StackBusyError'
  }
}

export class PreflightError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing required env files: ${missing.join(', ')}`)
    this.name = 'PreflightError'
  }
}

export class OperationNotFoundError extends Error {
  constructor(readonly operationId: string) {
    super(`Operation ${operationId} not found`)
    this.name = 'OperationNotFoundError'
  }
}
