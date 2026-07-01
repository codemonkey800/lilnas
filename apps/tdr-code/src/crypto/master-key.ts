import fs from 'node:fs'
import path from 'node:path'

import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

// Required: 32 bytes for AES-256-GCM.
const REQUIRED_KEY_BYTES = 32

// Load and validate the master key file. Fails fast and loud on any violation
// so neither process boots into a silent fleet-wide decrypt_failed state
// (Decision #7). Both main and bot must call this at startup.
export function loadMasterKey(): Buffer {
  const keyPath = env(EnvKeys.TDR_CODE_MASTER_KEY_FILE)

  let stat: fs.Stats
  try {
    stat = fs.statSync(keyPath)
  } catch {
    throw new Error(
      `[master-key] cannot stat key file at ${keyPath} — provision the file outside the backup tree with chmod 600`,
    )
  }

  if (!stat.isFile()) {
    throw new Error(
      `[master-key] key path is not a regular file: ${keyPath}`,
    )
  }

  const mode = stat.mode & 0o777
  if (mode !== 0o600) {
    throw new Error(
      `[master-key] key file must be chmod 600, got ${mode.toString(8)}: ${keyPath}`,
    )
  }

  if (stat.uid !== process.getuid!()) {
    throw new Error(
      `[master-key] key file must be owned by the current uid (${process.getuid!()}), got ${stat.uid}: ${keyPath}`,
    )
  }

  // Check parent directory permissions.
  const parentDir = path.dirname(keyPath)
  let parentStat: fs.Stats
  try {
    parentStat = fs.statSync(parentDir)
  } catch {
    throw new Error(
      `[master-key] cannot stat parent directory: ${parentDir}`,
    )
  }

  const parentMode = parentStat.mode & 0o777
  if (parentMode > 0o700) {
    throw new Error(
      `[master-key] parent directory must be at most chmod 700, got ${parentMode.toString(8)}: ${parentDir}`,
    )
  }

  if (parentStat.uid !== process.getuid!()) {
    throw new Error(
      `[master-key] parent directory must be owned by the current uid (${process.getuid!()}), got ${parentStat.uid}: ${parentDir}`,
    )
  }

  const buf = fs.readFileSync(keyPath)
  if (buf.length !== REQUIRED_KEY_BYTES) {
    throw new Error(
      `[master-key] key file must be exactly ${REQUIRED_KEY_BYTES} bytes, got ${buf.length}: ${keyPath}`,
    )
  }

  return buf
}
