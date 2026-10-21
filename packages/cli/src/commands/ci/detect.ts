import { Command, Flags } from '@oclif/core'
import { spawnSync } from 'child_process'

import {
  detect,
  DetectResult,
  readWorkspacePackages,
} from '../../utils/ci-detect'
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

export class CiDetect extends Command {
  static override description =
    'Turn the changes between two commits into the build/deploy plan (images, services to pull/up/force-recreate, env decrypt, check packages) the push-to-deploy workflow runs'

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
      workspacePackages: readWorkspacePackages(root),
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
    this.log(
      `images:          ${list(
        result.images.map(image =>
          image.gates.length > 0
            ? `${image.name}(${image.gates.join(' ')})`
            : image.name,
        ),
      )}`,
    )
    this.log(`pull:            ${list(result.pull)}`)
    this.log(`up:              ${list(result.up)}`)
    this.log(`forceRecreate:   ${list(result.forceRecreate)}`)
    this.log(`decryptServices: ${list(result.decryptServices)}`)
    this.log(`checkPackages:   ${list(result.checkPackages)}`)
    this.log(`changedFiles:    ${result.changedFiles.length}`)
  }
}
