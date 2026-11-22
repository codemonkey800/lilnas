#!/usr/bin/env node
// Runs the backend and the frontend side by side and exits as soon as either
// one exits, so a crashed process stops the container and Docker's restart
// policy brings it back.
//
// This replaces `run-p`, which finds a task's descendants with `ps`. The
// runtime image has no `ps`, so when the backend died npm-run-all could not
// reach next-server and the container stayed up with no Discord bot.
//
// Each server runs in its own process group (`detached`), and the whole group
// is signalled with `process.kill(-pid)`, which needs no process listing.

import { spawn } from 'node:child_process'

const SERVERS = {
  backend: ['node', ['dist/main']],
  frontend: ['node', ['frontend/apps/tdr-bot/server.js']],
}

// How long to wait for a graceful exit before sending SIGKILL.
const KILL_TIMEOUT_MS = 10_000

const children = new Map()
let shuttingDown = false

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    // The group is already gone.
  }
}

function shutdown(exitCode, signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode

  for (const child of children.values()) signalGroup(child, signal)

  setTimeout(() => {
    for (const child of children.values()) signalGroup(child, 'SIGKILL')
    process.exit(exitCode)
  }, KILL_TIMEOUT_MS).unref()
}

for (const [name, [command, args]] of Object.entries(SERVERS)) {
  const child = spawn(command, args, { stdio: 'inherit', detached: true })
  children.set(name, child)

  child.on('error', error => {
    console.error(`[start-servers] failed to start ${name}:`, error)
    children.delete(name)
    shutdown(1)
  })

  child.on('exit', (code, signal) => {
    children.delete(name)
    if (!shuttingDown) {
      console.error(
        `[start-servers] ${name} exited (${signal ?? `code ${code}`}), stopping the rest`,
      )
      // A server exiting on its own is always a failure here, even with code 0.
      shutdown(code || 1)
    }
    if (children.size === 0) process.exit(process.exitCode ?? 1)
  })
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => shutdown(0, signal))
}
