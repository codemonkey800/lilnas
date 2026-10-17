/* eslint-disable @typescript-eslint/no-require-imports */

// Healthcheck for the download-dev container (deploy.dev.yml).
//
// Two jobs:
//
// 1. Probe the frontend with a bare TCP connect, NOT an HTTP GET. `/` is a
//    dynamic page that SSRs four backend calls, and `next dev` retains memory
//    per render — a GET every 30s grew next-server ~0.1 GiB/hour until the
//    container hit its 6g limit and was OOM-killed (2026-10-06).
//
// 2. Restart the container when a dev process dies. `concurrently -k` cannot
//    be trusted to exit: when the OOM killer took the nest watcher, its
//    `dist/main` child was orphaned, kept concurrently's [0] pipe open, and
//    the whole tree sat half-dead for 11 days with `restart: unless-stopped`
//    never firing. The orphan keeps answering on 8081, so a port probe can't
//    see that case — the watcher process itself has to be looked for. Once
//    the frontend has been up, two consecutive failed checks (8080 refused,
//    or no nest watcher) signal PID 1 (tini, via `init: true`), the container
//    exits, and the restart policy brings it back.
//
// The state file lives on the /data tmpfs so it resets on every start —
// failures during `pnpm install` / first compile never count.

const fs = require('fs')
const net = require('net')

const STATE = '/data/.dev-healthcheck'
const FAILURES_BEFORE_RESTART = 2

const readFailures = () => {
  try {
    return Number(fs.readFileSync(STATE, 'utf8')) || 0
  } catch {
    return null // frontend never came up since this container start
  }
}

const nestWatcherAlive = () =>
  fs.readdirSync('/proc').some(pid => {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
      return (
        argv.some(arg => arg.endsWith('/nest.js')) && argv.includes('start')
      )
    } catch {
      return false // not a pid dir, or the process exited mid-scan
    }
  })

// Counts toward a restart only once the frontend has been up since this
// container start; before that, failures are just startup.
const fail = () => {
  const failures = readFailures()
  if (failures !== null) {
    fs.writeFileSync(STATE, String(failures + 1))
    if (failures + 1 >= FAILURES_BEFORE_RESTART) process.kill(1, 'SIGTERM')
  }
  process.exit(1)
}

const socket = net.connect(8080, '127.0.0.1')
socket.setTimeout(4000)

socket.on('connect', () => {
  socket.destroy()
  if (!nestWatcherAlive()) fail()
  fs.writeFileSync(STATE, '0')
  process.exit(0)
})

// A hung server is unhealthy but not dead; leave it alone.
socket.on('timeout', () => process.exit(1))

socket.on('error', fail)
