import path from 'node:path'

// Strict charset for acpSessionId — agent-authored, reject separators/traversal chars.
// UUID shape: hex + hyphens only; no dots, slashes, NUL.
const ACP_SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

// Escape a filesystem path for the claude projects directory:
//   '/' → '-'   '.' → '-'
function escapeCwd(cwd: string): string {
  // Normalize trailing slash before escaping so /a/b and /a/b/ produce the same key.
  const normalized = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd
  return normalized.replace(/[/.]/g, '-')
}

export interface JsonlLocatorResult {
  ok: true
  resolvedPath: string
}

export interface JsonlLocatorError {
  ok: false
  reason: 'invalid-acp-session-id' | 'path-traversal'
}

// Pure locator: (cwd, acpSessionId) → resolved JSONL path or error.
// No FS access — that is the caller's responsibility.
export function jsonlPath(
  cwd: string,
  acpSessionId: string,
): JsonlLocatorResult | JsonlLocatorError {
  if (!ACP_SESSION_ID_RE.test(acpSessionId)) {
    return { ok: false, reason: 'invalid-acp-session-id' }
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/root'
  const claudeProjectsRoot = path.resolve(home, '.claude', 'projects')
  const escapedCwd = escapeCwd(cwd)
  const candidate = path.resolve(
    claudeProjectsRoot,
    escapedCwd,
    `${acpSessionId}.jsonl`,
  )

  // Confinement assertion — must stay under ~/.claude/projects/
  const rootWithSep = claudeProjectsRoot.endsWith(path.sep)
    ? claudeProjectsRoot
    : claudeProjectsRoot + path.sep
  if (!candidate.startsWith(rootWithSep)) {
    return { ok: false, reason: 'path-traversal' }
  }

  return { ok: true, resolvedPath: candidate }
}
