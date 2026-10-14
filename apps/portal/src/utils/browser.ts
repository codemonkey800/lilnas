import {
  getContainerNetworkBytes,
  inspectContainer,
  startContainer,
  stopContainer,
} from 'src/utils/docker-engine'

// Hardcoded on purpose: the portal holds the Docker socket, so nothing a
// request sends may choose which container gets started or stopped. Must
// match container_name in infra/browser.yml.
const CONTAINER_NAME = 'lilnas-browser'

// Reachable over the shared compose network; used to tell "container
// running" apart from "Selkies UI actually serving".
const INTERNAL_UI_URL = 'http://browser:3000/'

export const BROWSER_URL = 'https://browser.lilnas.io'

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const MAX_UPTIME_MS = 4 * 60 * 60 * 1000

const WATCH_INTERVAL_MS = 60 * 1000

// Network traffic per watch interval that counts as "someone is using it".
// A connected Selkies viewer streams video (MBs per minute); an unwatched
// Chromium sitting on a page stays well under this.
const ACTIVE_BYTES_PER_INTERVAL = 512 * 1024

export type BrowserState = 'missing' | 'stopped' | 'starting' | 'running'

export interface BrowserStatus {
  state: BrowserState
  startedAt?: string
  lastActiveAt?: number
  autoStopAt?: number
}

interface ActivityState {
  startedAt: string
  lastBytes: number
  lastActiveAt: number
}

interface WatcherGlobals {
  browserActivity?: ActivityState
  browserWatcher?: NodeJS.Timeout
}

// instrumentation.ts and the app routes are bundled separately, so
// module-level state wouldn't be shared between the watcher and the page.
const globals = globalThis as typeof globalThis & WatcherGlobals

async function isUiReady() {
  try {
    const res = await fetch(INTERNAL_UI_URL, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

function getAutoStopAt(activity: ActivityState) {
  return Math.min(
    activity.lastActiveAt + IDLE_TIMEOUT_MS,
    Date.parse(activity.startedAt) + MAX_UPTIME_MS,
  )
}

export async function getBrowserStatus(): Promise<BrowserStatus> {
  const container = await inspectContainer(CONTAINER_NAME)

  if (!container) {
    return { state: 'missing' }
  }

  if (!container.Running) {
    return { state: 'stopped' }
  }

  const activity = globals.browserActivity
  const isCurrent = activity?.startedAt === container.StartedAt

  return {
    state: (await isUiReady()) ? 'running' : 'starting',
    startedAt: container.StartedAt,
    lastActiveAt: isCurrent ? activity.lastActiveAt : undefined,
    autoStopAt: isCurrent ? getAutoStopAt(activity) : undefined,
  }
}

export async function startBrowser() {
  await startContainer(CONTAINER_NAME)

  const container = await inspectContainer(CONTAINER_NAME)
  if (container?.Running) {
    globals.browserActivity = {
      startedAt: container.StartedAt,
      lastBytes: 0,
      lastActiveAt: Date.now(),
    }
  }
}

export async function stopBrowser() {
  await stopContainer(CONTAINER_NAME)
  globals.browserActivity = undefined
}

async function checkIdle() {
  const container = await inspectContainer(CONTAINER_NAME)

  if (!container?.Running) {
    globals.browserActivity = undefined
    return
  }

  const now = Date.now()
  const bytes = await getContainerNetworkBytes(CONTAINER_NAME)
  const activity = globals.browserActivity

  // First sighting of this run (portal restarted, or started outside the
  // portal): begin the idle clock now rather than guessing at the past.
  if (!activity || activity.startedAt !== container.StartedAt) {
    globals.browserActivity = {
      startedAt: container.StartedAt,
      lastBytes: bytes,
      lastActiveAt: now,
    }
    return
  }

  if (bytes - activity.lastBytes >= ACTIVE_BYTES_PER_INTERVAL) {
    activity.lastActiveAt = now
  }
  activity.lastBytes = bytes

  if (now >= getAutoStopAt(activity)) {
    const reason =
      now - activity.lastActiveAt >= IDLE_TIMEOUT_MS ? 'idle' : 'max uptime'
    console.log(`[browser] auto-stopping ${CONTAINER_NAME} (${reason})`)
    await stopBrowser()
  }
}

export function startBrowserIdleWatcher() {
  if (globals.browserWatcher) {
    return
  }

  globals.browserWatcher = setInterval(() => {
    checkIdle().catch((error: unknown) => {
      console.error('[browser] idle check failed', error)
    })
  }, WATCH_INTERVAL_MS)
}
