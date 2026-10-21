import type { ReapEstimate } from 'src/activity/host-activity.service'
import type { CalloutTone } from 'src/components/ui/callout'
import type { IconName } from 'src/components/ui/icon'
import type { DotTone } from 'src/components/ui/status'
import type { StackAction } from 'src/compose/compose.types'
import { formatAgo, formatDuration } from 'src/lib/format'
import type { ServiceView, StackView } from 'src/stacks/stacks.types'

/**
 * What a card says about a stack. The backend's `StackState` only counts
 * containers; the card also needs to know whether they are well, so this adds
 * the healthcheck and the env preflight (see `dev.pug`'s header).
 */
export type DisplayState =
  'healthy' | 'unhealthy' | 'exited' | 'absent' | 'busy' | 'env-missing'

const isRunning = (svc: ServiceView) => svc.container?.state === 'running'

/** A container that finished its job and left: `migrate` exiting 0. */
const finishedCleanly = (svc: ServiceView) =>
  svc.container?.state === 'exited' && !svc.container.exitCode

/** Required env files that are not on this host. */
export function missingEnvFiles(stack: StackView): string[] {
  return stack.envFiles.filter(f => f.required && !f.exists).map(f => f.path)
}

export function displayState(stack: StackView): DisplayState {
  if (stack.state === 'busy') return 'busy'
  if (stack.state !== 'running' && missingEnvFiles(stack).length > 0) {
    return 'env-missing'
  }
  if (stack.state === 'absent') return 'absent'
  if (
    stack.services.some(
      s => isRunning(s) && s.container?.health === 'unhealthy',
    )
  ) {
    return 'unhealthy'
  }
  if (stack.state === 'running') return 'healthy'
  if (
    stack.state === 'partial' &&
    stack.services.every(s => isRunning(s) || finishedCleanly(s))
  ) {
    return 'healthy'
  }
  return 'exited'
}

export interface ActionAvailability {
  up: boolean
  stop: boolean
  restart: boolean
  recreate: boolean
  down: boolean
}

/** Which actions mean something in this state (`dev.pug`'s `+stackActions`). */
export function actionAvailability(stack: StackView): ActionAvailability {
  const state = displayState(stack)
  if (state === 'busy') {
    return {
      up: false,
      stop: false,
      restart: false,
      recreate: false,
      down: false,
    }
  }
  // The backend's env preflight guards up, recreate and restart only; Stop and
  // Down need no env file and still mean something while containers exist.
  if (state === 'env-missing') {
    return {
      up: false,
      stop: stack.services.some(isRunning),
      restart: false,
      recreate: false,
      down: stack.services.some(s => s.container),
    }
  }
  if (state === 'absent') {
    return {
      up: true,
      stop: false,
      restart: false,
      recreate: false,
      down: false,
    }
  }
  return {
    up: state === 'exited',
    stop: stack.services.some(isRunning),
    restart: true,
    recreate: true,
    down: true,
  }
}

export const ACTION_ORDER: readonly StackAction[] = [
  'up',
  'stop',
  'restart',
  'recreate',
  'down',
]

/** Dot tone for one container: state first, then its healthcheck. */
export function serviceTone(svc: ServiceView): DotTone | undefined {
  const c = svc.container
  if (!c) return undefined
  switch (c.state) {
    case 'running':
      if (c.health === 'unhealthy') return 'bad'
      return c.health === 'starting' ? 'warn' : 'ok'
    case 'created':
    case 'restarting':
      return 'warn'
    case 'exited':
      return c.exitCode ? 'bad' : undefined
    case 'dead':
      return 'bad'
    default:
      return undefined
  }
}

/** The one-line verdict beside the container name. */
export function serviceVerdict(svc: ServiceView): string {
  const c = svc.container
  if (!c) return 'no container'
  switch (c.state) {
    case 'running':
      return c.health ?? 'running'
    case 'exited':
      return `exited (${c.exitCode ?? 0})`
    case 'created':
      return 'starting'
    default:
      return c.state
  }
}

export function serviceName(svc: ServiceView): string {
  return svc.container?.name ?? svc.containerName
}

export interface ReapNote {
  text: string
  /** Why, when the word alone isn't enough. */
  title?: string
  warn: boolean
}

/** The reaper's verdict for one running container. */
export function reapNote(reap: ReapEstimate, now: number): ReapNote {
  if (reap.basis === 'disabled') {
    return {
      text: 'exempt',
      title: 'lilnas.idle-reap.enabled=false',
      warn: false,
    }
  }

  if (reap.basis === 'unknown') {
    return {
      text: 'unknown',
      title: 'auth didn’t answer, so the reaper leaves this alone',
      warn: true,
    }
  }

  if (reap.activeUsers) {
    const n = reap.activeUsers
    return {
      text: `kept: ${n} active ${n === 1 ? 'user' : 'users'}`,
      warn: false,
    }
  }

  const reapsAt = reap.reapsAt ? Date.parse(reap.reapsAt) : NaN
  if (Number.isNaN(reapsAt)) return { text: 'unknown', warn: true }
  return {
    text:
      reapsAt <= now
        ? 'reaps soon'
        : `reaps in ${formatDuration(reapsAt - now)}`,
    warn: false,
  }
}

/**
 * The compose file as the mockup writes it: `apps/download/deploy.dev.yml`
 * for a lilnas app, `~/dev/hop-road/docker-compose.dev.yml` for a project.
 */
export function shortPath(path: string): string {
  const apps = path.lastIndexOf('/apps/')
  if (apps !== -1) return path.slice(apps + 1)

  const dev = path.indexOf('/dev/')
  if (dev !== -1) return `~${path.slice(dev)}`

  return path
}

export interface StackNote {
  tone: CalloutTone
  icon: IconName
  text: string
  detail?: string
}

/** The callout under a card's containers, when the state has something to add. */
export function stackNote(stack: StackView, now: number): StackNote | null {
  switch (displayState(stack)) {
    case 'unhealthy': {
      const sick = stack.services.find(
        s => isRunning(s) && s.container?.health === 'unhealthy',
      )
      return sick
        ? {
            tone: 'bad',
            icon: 'alert',
            text: `${serviceName(sick)} is failing its healthcheck.`,
          }
        : null
    }
    case 'exited': {
      const failed = stack.services.find(s => s.container?.exitCode)
      if (!failed?.container) return null
      return {
        tone: 'bad',
        icon: 'alert',
        text: `${serviceName(failed)} exited with code ${failed.container.exitCode}, ${formatAgo(failed.container.finishedAt, now)}.`,
        detail: 'Check its logs before bringing it back up.',
      }
    }
    case 'absent':
      return {
        tone: 'mute',
        icon: 'clock',
        text: 'No containers.',
        detail: 'Up brings it back; its volumes are kept.',
      }
    default:
      return null
  }
}
