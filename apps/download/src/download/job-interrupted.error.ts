/**
 * Why a deliberately-killed job stopped. Pause and cancel are the *same*
 * primitive at the process level (`proc.kill()`, SIGTERM, nothing deleted) —
 * only the intent differs, and only the intent decides what status the job
 * lands in afterwards.
 */
export type JobInterruptKind = 'cancel' | 'pause'

/**
 * Thrown by the video pipeline when a yt-dlp/ffmpeg process exited non-zero
 * *because someone killed it on purpose*, rather than because it crashed.
 *
 * A killed child process is indistinguishable from a failed one by exit code
 * alone, so the pipeline reads the recorded intent
 * (`DownloadStateService.getInterruption()`) at the moment the process closes
 * and throws this instead of a generic `Error`. That makes it a sentinel: the
 * scheduler's `catch` branches on `instanceof JobInterruptedError` to land the
 * job in Cancelled/Paused instead of blanket-marking it Failed.
 */
export class JobInterruptedError extends Error {
  constructor(
    readonly jobId: string,
    readonly kind: JobInterruptKind,
  ) {
    super(`Job '${jobId}' was interrupted deliberately (${kind})`)

    this.name = 'JobInterruptedError'
    // ts-jest compiles this file to a target whose `Error` subclassing breaks
    // `instanceof` (the constructor's return value replaces `this`, losing the
    // subclass prototype). The scheduler branch *is* an `instanceof` check, so
    // without this the sentinel silently degrades to "crashed" under test.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
