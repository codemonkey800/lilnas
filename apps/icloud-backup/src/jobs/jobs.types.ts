import { statfs } from 'node:fs/promises'

/** The person making a request, as the controller resolves it. */
export interface JobUser {
  email: string
  userId: string
  isAdmin: boolean
}

/**
 * Timers and the wall clock behind one seam, so specs can run ten minutes of
 * retries without waiting.
 */
export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export const CLOCK = Symbol('JOBS_CLOCK')

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: handle => clearInterval(handle as NodeJS.Timeout),
}

/** Free space of the filesystem holding `path`. */
export type StatfsFn = (
  path: string,
) => Promise<{ bavail: number; bsize: number }>

export const STATFS = Symbol('JOBS_STATFS')

export const nodeStatfs: StatfsFn = path => statfs(path)
