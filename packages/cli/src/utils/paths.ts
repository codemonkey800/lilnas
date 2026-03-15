import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Resolves the monorepo root directory.
 *
 * Primary strategy: walk up from this file's directory (packages/cli/src/utils/)
 * to find the root (identified by pnpm-workspace.yaml).
 * Fallback: git rev-parse --show-toplevel.
 */
export function getMonorepoRoot(): string {
  // Walk up from packages/cli/src/utils/ -> packages/cli/src/ -> packages/cli/ -> packages/ -> root
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fallback to git
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
    }).trim()
  } catch {
    throw new Error('Could not determine monorepo root directory')
  }
}

export function getComposeFile(root: string): string {
  return path.join(root, 'docker-compose.yml')
}
