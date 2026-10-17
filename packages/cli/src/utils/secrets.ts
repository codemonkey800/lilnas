import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * The committed, dotenvx-encrypted env files: `apps/<app>/.env.prod`,
 * `infra/.env` and `infra/.env.<name>`, minus the `.example` templates and the
 * `.decrypted` siblings the deploy writes next to them. The `.gitignore`
 * negations and the deploy script must agree with this rule.
 */
const ENCRYPTED_ENV_FILE =
  /^(?:apps\/[^/]+\/\.env\.prod|infra\/\.env(?:\.[^/]+)?)$/

/** The four `#/----…/` banner lines dotenvx writes above the public key. */
const DOTENVX_BANNER_LINE = /^#\/.*\/\s*$/

/** `DOTENV_PUBLIC_KEY=…` or `DOTENV_PUBLIC_KEY_<ENV>=…`, optionally `export`ed. */
const PUBLIC_KEY_LINE = /^\s*(?:export\s+)?DOTENV_PUBLIC_KEY(?:_[^\s=]+)?\s*=/

/** A `KEY=value` line, optionally `export`ed; captures the key and raw value. */
const ENV_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/

const ENCRYPTED_VALUE_PREFIX = 'encrypted:'

/**
 * Applies the discovery rule to a `git ls-files` listing and returns the
 * matching files as absolute paths under `root`, sorted by their repo path.
 */
export function listEncryptedEnvFiles(
  root: string,
  trackedFiles: string[],
): string[] {
  return trackedFiles
    .map(file => file.trim())
    .filter(
      file =>
        ENCRYPTED_ENV_FILE.test(file) &&
        !file.endsWith('.example') &&
        !file.endsWith('.decrypted'),
    )
    .sort()
    .map(file => path.join(root, file))
}

/** `git ls-files` for `root`, one repo-relative path per entry. */
export function gitTrackedFiles(root: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim()}`)
  }

  return result.stdout.split('\0').filter(Boolean)
}

/** The plaintext sibling compose reads: `<file>.decrypted`. */
export function decryptedPathFor(file: string): string {
  return `${file}.decrypted`
}

/**
 * The `.env.keys` variable dotenvx looks up for `file`, mirroring its
 * `keynames` convention: `.env` → `DOTENV_PRIVATE_KEY`, `.env.<env>` →
 * `DOTENV_PRIVATE_KEY_<ENV>` with `<env>` upper-cased verbatim (so
 * `.env.nexus-code` → `DOTENV_PRIVATE_KEY_NEXUS-CODE`).
 */
export function privateKeyNameFor(file: string): string {
  const name = path.basename(file)

  if (name === '.env') {
    return 'DOTENV_PRIVATE_KEY'
  }

  return `DOTENV_PRIVATE_KEY_${name.replace(/^\.env\./, '').toUpperCase()}`
}

/**
 * Drops dotenvx's banner lines and the `DOTENV_PUBLIC_KEY` line from a
 * decrypted file so the container env matches the pre-dotenvx file exactly.
 * Every other line — comments, blank lines, the trailing newline — is kept
 * verbatim.
 */
export function stripDotenvxHeader(decrypted: string): string {
  return decrypted
    .split('\n')
    .filter(
      line => !DOTENVX_BANNER_LINE.test(line) && !PUBLIC_KEY_LINE.test(line),
    )
    .join('\n')
}

/** A trailing inline comment on an unquoted value: whitespace then `#…`. */
const UNQUOTED_INLINE_COMMENT = /\s+#.*$/

/** What may follow a closing quote: nothing, or an inline `#…` comment. */
const AFTER_CLOSING_QUOTE = /^\s*(?:#.*)?$/

/**
 * Reduces a raw `KEY=` right-hand side to the value dotenvx would read.
 * dotenvx keeps a source line's inline comment when it encrypts, so a
 * committed line can be `KEY="encrypted:…" # note`: a quoted value ends at
 * the matching closing quote and whatever follows is a comment, while an
 * unquoted value follows dotenv's rule that ` #` starts one. A `#` inside
 * the quotes is part of the value.
 */
function unquote(value: string): string {
  const trimmed = value.trim()
  const first = trimmed[0]

  if (first === '"' || first === "'" || first === '`') {
    const close = trimmed.indexOf(first, 1)

    if (close !== -1 && AFTER_CLOSING_QUOTE.test(trimmed.slice(close + 1))) {
      return trimmed.slice(1, close)
    }

    return trimmed
  }

  return trimmed.replace(UNQUOTED_INLINE_COMMENT, '')
}

interface ParsedEnvLine {
  key: string
  value: string
}

/**
 * Yields the `KEY=value` lines of an env file, skipping blanks and comments.
 * Lines that aren't `KEY=value` at all come back with `key` set to
 * `line <n>` so callers can report them without echoing their contents.
 */
function parseEnvLines(content: string): ParsedEnvLine[] {
  const parsed: ParsedEnvLine[] = []

  content.split('\n').forEach((raw, index) => {
    const line = raw.trim()

    if (line === '' || line.startsWith('#')) {
      return
    }

    const match = ENV_LINE.exec(line)

    if (!match) {
      parsed.push({ key: `line ${index + 1}`, value: line })
      return
    }

    parsed.push({ key: match[1] ?? '', value: unquote(match[2] ?? '') })
  })

  return parsed
}

function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_VALUE_PREFIX)
}

/**
 * True when every non-blank, non-comment line is `KEY=encrypted:…`
 * (optionally quoted) or the `DOTENV_PUBLIC_KEY` line. An empty value counts
 * as plaintext: dotenvx encrypts empty strings too, so a bare `KEY=` means
 * the file was edited by hand after encryption.
 */
export function isFullyEncrypted(content: string): {
  ok: boolean
  plaintextKeys: string[]
} {
  const plaintextKeys = parseEnvLines(content)
    .filter(
      ({ key, value }) =>
        !key.startsWith('DOTENV_PUBLIC_KEY') && !isEncryptedValue(value),
    )
    .map(({ key }) => key)

  return { ok: plaintextKeys.length === 0, plaintextKeys }
}

/** Keys whose value is still `encrypted:…` — a decrypt that silently failed. */
function encryptedKeysIn(content: string): string[] {
  return parseEnvLines(content)
    .filter(({ value }) => isEncryptedValue(value))
    .map(({ key }) => key)
}

export function dotenvxBin(root: string): string {
  return path.join(root, 'node_modules', '.bin', 'dotenvx')
}

export interface DecryptEnvFileOptions {
  root: string
  file: string
  keysFile: string
}

export type DecryptEnvFileResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

/**
 * First meaningful stderr line from dotenvx with every `=value` blanked, so a
 * failure can be reported without the risk of echoing a key.
 */
function summarizeDotenvxError(stderr: string, status: number | null): string {
  const line = stderr
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '')

  if (!line) {
    return `dotenvx exited with status ${status ?? 'unknown'}`
  }

  return line.replace(/=\S+/g, '=…')
}

/**
 * Runs `dotenvx decrypt --stdout` for one file and returns its plaintext with
 * the dotenvx header stripped. The plaintext only ever lives in memory here;
 * callers decide where it goes.
 */
export function decryptEnvFile({
  root,
  file,
  keysFile,
}: DecryptEnvFileOptions): DecryptEnvFileResult {
  const result = spawnSync(
    dotenvxBin(root),
    ['decrypt', '-fk', keysFile, '-f', file, '--stdout'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  if (result.error) {
    return { ok: false, error: result.error.message }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: summarizeDotenvxError(result.stderr, result.status),
    }
  }

  const content = stripDotenvxHeader(result.stdout)
  const stillEncrypted = encryptedKeysIn(content)

  if (stillEncrypted.length > 0) {
    return {
      ok: false,
      error: `values still encrypted after decrypt: ${stillEncrypted.join(', ')}`,
    }
  }

  return { ok: true, content }
}

/**
 * Writes `content` to `target` with mode 0600 via a temp file in the same
 * directory and an atomic rename, so a reader never sees a partial file and
 * the plaintext is never world-readable, even briefly.
 */
export function writeFileAtomic0600(target: string, content: string): void {
  const tmp = `${target}.tmp-${process.pid}`

  fs.rmSync(tmp, { force: true })
  const fd = fs.openSync(tmp, 'wx', 0o600)

  try {
    fs.writeFileSync(fd, content)
    fs.fchmodSync(fd, 0o600)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  try {
    fs.renameSync(tmp, target)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}
