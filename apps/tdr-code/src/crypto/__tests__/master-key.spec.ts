import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import { loadMasterKey } from 'src/crypto/master-key'
import { EnvKeys } from 'src/env'

function writeKeyFile(
  dir: string,
  opts: {
    bytes?: number
    mode?: number
    dirMode?: number
    uid?: number
  } = {},
): string {
  const keyPath = path.join(dir, 'master.key')
  const buf = crypto.randomBytes(opts.bytes ?? 32)
  fs.writeFileSync(keyPath, buf, { mode: opts.mode ?? 0o600 })
  if (opts.dirMode !== undefined) {
    fs.chmodSync(dir, opts.dirMode)
  }
  return keyPath
}

describe('loadMasterKey', () => {
  let tmpDir: string
  const originalUid = process.getuid?.() ?? 0

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-masterkey-test-'))
    fs.chmodSync(tmpDir, 0o700)
  })

  afterEach(() => {
    // Restore dir mode so cleanup can succeed
    try {
      fs.chmodSync(tmpDir, 0o700)
    } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE]
  })

  it('loads a valid 32-byte key file (chmod 600, dir 700)', () => {
    const keyPath = writeKeyFile(tmpDir)
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = keyPath
    const key = loadMasterKey()
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })

  it('throws when the file is missing', () => {
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = path.join(tmpDir, 'nonexistent.key')
    expect(() => loadMasterKey()).toThrow()
  })

  it('throws when the key file is fewer than 32 bytes', () => {
    const keyPath = writeKeyFile(tmpDir, { bytes: 16 })
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = keyPath
    expect(() => loadMasterKey()).toThrow(/32 bytes/)
  })

  it('throws when the key file is more than 32 bytes', () => {
    const keyPath = writeKeyFile(tmpDir, { bytes: 64 })
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = keyPath
    expect(() => loadMasterKey()).toThrow(/32 bytes/)
  })

  it('throws when the key file mode is not 600', () => {
    const keyPath = writeKeyFile(tmpDir, { mode: 0o644 })
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = keyPath
    expect(() => loadMasterKey()).toThrow(/chmod 600/)
  })

  it('throws when the key path is a directory, not a regular file', () => {
    const dirPath = path.join(tmpDir, 'keydir')
    fs.mkdirSync(dirPath, { mode: 0o600 })
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = dirPath
    expect(() => loadMasterKey()).toThrow(/regular file/)
  })

  it('throws when the parent directory mode is looser than 700', () => {
    // Use a sub-directory with loose perms as the parent
    const looseDir = path.join(tmpDir, 'looseParent')
    fs.mkdirSync(looseDir, { mode: 0o755 })
    const keyPath = path.join(looseDir, 'master.key')
    fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 })
    process.env[EnvKeys.TDR_CODE_MASTER_KEY_FILE] = keyPath
    expect(() => loadMasterKey()).toThrow(/parent directory/)
  })
})
