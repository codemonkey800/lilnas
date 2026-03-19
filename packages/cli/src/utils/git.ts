import { execSync } from 'child_process'

import { runSshCommand, runSshCommandCapture } from './ssh'

export interface RemoteSyncOptions {
  host?: string
  dryRun?: boolean
  log?: (msg: string) => void
}

/**
 * Returns the current local branch name.
 */
export function getLocalBranch(): string {
  return execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
  }).trim()
}

/**
 * Returns the current local commit hash.
 */
export function getLocalHash(): string {
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
}

/**
 * Ensures the remote server's git repo is on the same branch and commit as
 * the local working copy, then conditionally rebuilds the CLI if relevant
 * files changed.
 *
 * Logic:
 * - Same branch + same hash → already in sync, skip everything
 * - Same branch + different hash → fetch + reset to local branch tip
 * - Different branch → fetch + checkout + reset to local branch tip
 *
 * After any sync, checks whether packages/cli/ or pnpm-lock.yaml changed
 * between the old and new remote hashes. Rebuilds only when they did.
 */
export function ensureRemoteSync({
  host,
  dryRun = false,
  log = console.log,
}: RemoteSyncOptions = {}): void {
  const localBranch = getLocalBranch()
  const localHash = getLocalHash()

  log(
    `Checking remote sync (branch: ${localBranch}, hash: ${localHash.slice(0, 8)})...`,
  )

  if (dryRun) {
    log(`[dry-run] Would check remote branch and hash via SSH`)
    log(`[dry-run] Would sync remote to branch '${localBranch}' if needed`)
    return
  }

  const captureOpts = { host }

  const remoteBranch = runSshCommandCapture({
    command: 'git rev-parse --abbrev-ref HEAD',
    ...captureOpts,
  }).trim()

  const remoteHashBefore = runSshCommandCapture({
    command: 'git rev-parse HEAD',
    ...captureOpts,
  }).trim()

  if (remoteBranch === localBranch && remoteHashBefore === localHash) {
    log(
      `Remote is already up to date on branch '${localBranch}' (${localHash.slice(0, 8)})`,
    )
    return
  }

  if (remoteBranch !== localBranch) {
    log(`Switching remote from branch '${remoteBranch}' to '${localBranch}'...`)
    runSshCommand({
      command: `git fetch origin ${localBranch} && git checkout ${localBranch} && git reset --hard origin/${localBranch}`,
      host,
    })
  } else {
    log(
      `Updating remote branch '${localBranch}' (${remoteHashBefore.slice(0, 8)} → ${localHash.slice(0, 8)})...`,
    )
    runSshCommand({
      command: `git fetch origin ${localBranch} && git reset --hard origin/${localBranch}`,
      host,
    })
  }

  const remoteHashAfter = runSshCommandCapture({
    command: 'git rev-parse HEAD',
    ...captureOpts,
  }).trim()

  const changedFiles = runSshCommandCapture({
    command: `git diff --name-only ${remoteHashBefore} ${remoteHashAfter} -- packages/cli/ pnpm-lock.yaml`,
    ...captureOpts,
  }).trim()

  if (changedFiles.length > 0) {
    log(
      `CLI source or lockfile changed — reinstalling dependencies and rebuilding CLI...`,
    )
    runSshCommand({ command: 'pnpm install', host })
    runSshCommand({ command: 'pnpm --filter @lilnas/cli build', host })
  } else {
    log(`No CLI changes detected — skipping rebuild`)
  }

  log(
    `Remote synced to branch '${localBranch}' (${remoteHashAfter.slice(0, 8)})`,
  )
}
