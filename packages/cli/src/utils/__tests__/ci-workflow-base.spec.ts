import { spawnSync } from 'child_process'
import * as fs from 'fs'
import yaml from 'js-yaml'
import * as os from 'os'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../../../../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml')
const LAST_DEPLOYED = path.join(ROOT, 'scripts/ci/last-deployed-sha.sh')

/** A `gh` that answers `run list` from env and records its argv. */
const STUB_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_GH_LOG"
if [ "$1 $2" = "run list" ]; then
  printf '%s' "$STUB_GH_RUN_LIST"
  exit "\${STUB_GH_EXIT:-0}"
fi
exit 1
`

interface Step {
  name?: string
  env?: Record<string, string>
  run?: string
}

interface Workflow {
  on: {
    workflow_dispatch: { inputs: Record<string, { type: string }> }
  }
  jobs: { detect: { steps: Step[] } }
}

function loadWorkflow(): Workflow {
  return yaml.load(fs.readFileSync(WORKFLOW, 'utf8')) as Workflow
}

function detectStep(): Step {
  const step = loadWorkflow().jobs.detect.steps.find(
    s => s.name === 'Detect changes',
  )
  if (!step?.run) throw new Error('detect job has no "Detect changes" step')
  return step
}

/** The step's base-selection `case … esac`, run on its own. */
function baseSelection(): string {
  const run = detectStep().run as string
  const end = run.indexOf('\nesac')
  if (end === -1) throw new Error('"Detect changes" has no case block')
  return `${run.slice(0, end + '\nesac'.length)}\necho "$BASE"\n`
}

/** The base is the last line; `::warning::` annotations come before it. */
function lastLine(stdout: string): string {
  return stdout.trim().split('\n').pop() as string
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

/** The `gh run list` JSON for one successful run. */
const runList = (headSha: string, databaseId = 1234): string =>
  JSON.stringify([{ headSha, databaseId }])

describe('ci.yml detect base', () => {
  let repo: string
  let stubDir: string
  let ghLog: string
  const commits: string[] = []
  /** The `n`th commit (0-based), oldest first. */
  const commit = (n: number): string => commits[n] as string

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-workflow-base-'))
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-workflow-gh-'))
    ghLog = path.join(stubDir, 'gh.log')
    fs.writeFileSync(path.join(stubDir, 'gh'), STUB_GH, { mode: 0o755 })
    git(repo, ['init', '--quiet'])
    for (const n of [1, 2, 3]) {
      fs.writeFileSync(path.join(repo, 'f'), `${n}\n`)
      git(repo, ['add', 'f'])
      git(repo, [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        'commit',
        '--quiet',
        '-m',
        `c${n}`,
      ])
      commits.push(git(repo, ['rev-parse', 'HEAD']))
    }
  })

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(stubDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    fs.rmSync(ghLog, { force: true })
  })

  /** Env that points `gh` at the stub, which answers `run list` with `list`. */
  function stubGh(list: string, exit = 0): Record<string, string> {
    return {
      PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`,
      STUB_GH_LOG: ghLog,
      STUB_GH_RUN_LIST: list,
      STUB_GH_EXIT: String(exit),
    }
  }

  function selectBase(env: Record<string, string>) {
    return spawnSync('bash', ['-eo', 'pipefail', '-c', baseSelection()], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        GITHUB_WORKSPACE: ROOT,
        REF_NAME: 'main',
        ...env,
      },
    })
  }

  it('exposes a string `base` dispatch input wired into the step', () => {
    expect(loadWorkflow().on.workflow_dispatch.inputs.base?.type).toBe('string')
    expect(detectStep().env?.DISPATCH_BASE).toBe('${{ inputs.base }}')
  })

  it('diffs a dispatch from the given base, so earlier commits deploy', () => {
    const result = selectBase({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_BASE: commit(0).slice(0, 8),
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(commit(0))
  })

  it('falls back to HEAD~1 for a dispatch without a base or a run', () => {
    const result = selectBase({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_BASE: '',
      ...stubGh('[]'),
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(commit(1))
  })

  it('diffs a dispatch without a base from the last successful push run', () => {
    const result = selectBase({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_BASE: '',
      ...stubGh(runList(commit(0))),
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(commit(0))
  })

  it('fails a dispatch whose base is not a commit', () => {
    const result = selectBase({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_BASE: 'no-such-ref',
      ...stubGh(runList(commit(0))),
    })
    expect(result.status).not.toBe(0)
  })

  it('uses the pull request base for a pull request', () => {
    const result = selectBase({
      EVENT_NAME: 'pull_request',
      PR_BASE: commit(0),
      PUSH_BEFORE: commit(1),
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(commit(0))
  })

  it('diffs a push from the last successful push run', () => {
    const result = selectBase({
      EVENT_NAME: 'push',
      PUSH_BEFORE: commit(1),
      DISPATCH_BASE: '',
      ...stubGh(runList(commit(0))),
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(commit(0))
    const calls = fs.readFileSync(ghLog, 'utf8')
    expect(calls).toContain('--branch main --event push --status success')
  })

  it('looks the last push run up on the pushed branch', () => {
    selectBase({
      EVENT_NAME: 'push',
      PUSH_BEFORE: commit(1),
      REF_NAME: 'release',
      ...stubGh(runList(commit(0))),
    })
    expect(fs.readFileSync(ghLog, 'utf8')).toContain('--branch release ')
  })

  it('falls back to event.before for a push with no successful run', () => {
    const result = selectBase({
      EVENT_NAME: 'push',
      PUSH_BEFORE: commit(1),
      ...stubGh('[]'),
    })
    expect(result.status).toBe(0)
    expect(lastLine(result.stdout)).toBe(commit(1))
    expect(result.stdout).toContain(
      '::warning::no successful push run on main; diffing from event.before',
    )
  })

  it('falls back to event.before when gh fails, without failing the step', () => {
    const result = selectBase({
      EVENT_NAME: 'push',
      PUSH_BEFORE: commit(1),
      ...stubGh('', 1),
    })
    expect(result.status).toBe(0)
    expect(lastLine(result.stdout)).toBe(commit(1))
  })

  it('passes a run sha missing from the repo through (detect goes full)', () => {
    const missing = 'a'.repeat(40)
    const result = selectBase({
      EVENT_NAME: 'push',
      PUSH_BEFORE: commit(1),
      ...stubGh(runList(missing)),
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(missing)
  })
})

describe('scripts/ci/last-deployed-sha.sh', () => {
  let stubDir: string
  let ghLog: string

  beforeAll(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-deployed-gh-'))
    ghLog = path.join(stubDir, 'gh.log')
    fs.writeFileSync(path.join(stubDir, 'gh'), STUB_GH, { mode: 0o755 })
  })

  afterAll(() => {
    fs.rmSync(stubDir, { recursive: true, force: true })
  })

  function run(list: string, exit = 0) {
    return spawnSync(LAST_DEPLOYED, ['main'], {
      encoding: 'utf8',
      env: {
        GH_TOKEN: 'x',
        PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_GH_LOG: ghLog,
        STUB_GH_RUN_LIST: list,
        STUB_GH_EXIT: String(exit),
      },
    })
  }

  it('prints "<sha> <run id>" for the newest successful push run', () => {
    const sha = 'b'.repeat(40)
    const result = run(runList(sha, 987))
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(`${sha} 987`)
  })

  it('prints nothing when there is no successful push run', () => {
    const result = run('[]')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints nothing and exits 0 when gh fails', () => {
    const result = run('', 1)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints nothing and exits 0 on unparsable JSON', () => {
    const result = run('not json')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })
})
