import { Command, Flags } from '@oclif/core'
import { spawnSync } from 'child_process'

import { detect, DetectResult } from '../../utils/ci-detect'
import { getMonorepoRoot } from '../../utils/paths'

const ZERO_SHA = /^0+$/

function git(root: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  return result.status === 0 ? result.stdout : null
}

/** `base` resolves to a commit that is an ancestor of `head`. */
function isUsableBase(root: string, base: string, head: string): boolean {
  if (ZERO_SHA.test(base)) return false
  if (git(root, ['cat-file', '-e', `${base}^{commit}`]) === null) return false
  return git(root, ['merge-base', '--is-ancestor', base, head]) !== null
}

function changedFiles(root: string, base: string, head: string): string[] {
  const out = git(root, ['diff', '--name-only', `${base}..${head}`])
  if (out === null) {
    throw new Error(`git diff --name-only ${base}..${head} failed`)
  }
  return out.split('\n').filter(Boolean)
}

/** Package dirs from `turbo ls --affected --output json` (`packages.items[].path`). */
function affectedPackages(root: string, base: string, head: string): string[] {
  const result = spawnSync(
    'pnpm',
    ['exec', 'turbo', 'ls', '--affected', '--output', 'json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head },
    },
  )
  if (result.status !== 0) {
    throw new Error(`turbo ls --affected failed: ${result.stderr.trim()}`)
  }

  const parsed: unknown = JSON.parse(result.stdout)
  const items =
    typeof parsed === 'object' &&
    parsed !== null &&
    'packages' in parsed &&
    typeof parsed.packages === 'object' &&
    parsed.packages !== null &&
    'items' in parsed.packages &&
    Array.isArray(parsed.packages.items)
      ? (parsed.packages.items as unknown[])
      : []

  return items.flatMap(item =>
    typeof item === 'object' &&
    item !== null &&
    'path' in item &&
    typeof item.path === 'string'
      ? [item.path]
      : [],
  )
}

export class CiDetect extends Command {
  static override description =
    'Turn the changes between two commits into the build/deploy plan (images, services to pull/up/force-recreate, env decrypt, test packages) the push-to-deploy workflow runs'

  static override examples = [
    '<%= config.bin %> ci detect --base HEAD~1 --head HEAD',
    '<%= config.bin %> ci detect --base "$GITHUB_EVENT_BEFORE" --head "$GITHUB_SHA" --json',
    '<%= config.bin %> ci detect --full --json',
  ]

  static override flags = {
    base: Flags.string({
      description:
        'Commit to diff from; unset, all zeros or not an ancestor of --head means "everything changed"',
    }),
    head: Flags.string({
      description: 'Commit to diff to',
      default: 'HEAD',
    }),
    full: Flags.boolean({
      description: 'Plan as if everything changed',
    }),
    json: Flags.boolean({
      description: 'Print the plan as a single JSON object',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(CiDetect)
    const root = getMonorepoRoot()
    const head = flags.head
    const base = flags.base

    const full =
      flags.full || base === undefined || !isUsableBase(root, base, head)

    const result = detect({
      root,
      full,
      changedFiles: full || !base ? [] : changedFiles(root, base, head),
      affectedPackages: full || !base ? [] : affectedPackages(root, base, head),
    })

    if (flags.json) {
      this.log(JSON.stringify(result))
      return
    }

    this.printSummary(result)
  }

  private printSummary(result: DetectResult): void {
    const list = (values: string[]): string =>
      values.length > 0 ? values.join(' ') : '(none)'

    this.log(`full:            ${result.full}`)
    this.log(`baseImages:      ${result.baseImages}`)
    this.log(`decrypt:         ${result.decrypt}`)
    this.log(`images:          ${list(result.images.map(image => image.name))}`)
    this.log(`pull:            ${list(result.pull)}`)
    this.log(`up:              ${list(result.up)}`)
    this.log(`forceRecreate:   ${list(result.forceRecreate)}`)
    this.log(`testPackages:    ${list(result.testPackages)}`)
    this.log(`changedFiles:    ${result.changedFiles.length}`)
  }
}
