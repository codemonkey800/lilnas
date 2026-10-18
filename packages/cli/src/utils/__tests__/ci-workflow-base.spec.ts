import { spawnSync } from 'child_process'
import * as fs from 'fs'
import yaml from 'js-yaml'
import * as os from 'os'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../../../../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml')

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

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

describe('ci.yml detect base', () => {
  let repo: string
  const commits: string[] = []
  /** The `n`th commit (0-based), oldest first. */
  const commit = (n: number): string => commits[n] as string

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-workflow-base-'))
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
  })

  function selectBase(env: Record<string, string>) {
    return spawnSync('bash', ['-eo', 'pipefail', '-c', baseSelection()], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
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

  it('falls back to HEAD~1 for a dispatch without a base', () => {
    const result = selectBase({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_BASE: '',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(commit(1))
  })

  it('fails a dispatch whose base is not a commit', () => {
    const result = selectBase({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_BASE: 'no-such-ref',
    })
    expect(result.status).not.toBe(0)
  })

  it('still uses event.before for a push', () => {
    const result = selectBase({
      EVENT_NAME: 'push',
      PUSH_BEFORE: commit(0),
      DISPATCH_BASE: commit(1),
    })
    expect(result.stdout.trim()).toBe(commit(0))
  })
})
