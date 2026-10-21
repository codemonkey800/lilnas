import { spawnSync } from 'child_process'
import * as fs from 'fs'
import { load } from 'js-yaml'
import * as os from 'os'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../../../../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml')
const SCRIPT = path.join(ROOT, 'scripts/ci/cancel-superseded-runs.sh')

const THIS_RUN = 500

/**
 * A `gh` that answers the run list from $STUB_RUNS_JSON and a run's jobs from
 * $STUB_JOBS_DIR/<id>.json, and records its argv.
 */
const STUB_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_GH_LOG"
case "$*" in
  "api "*"/runs?"*) printf '%s' "$STUB_RUNS_JSON" ;;
  "api "*"/runs/"*"/jobs")
    id="\${*%/jobs}"
    id="\${id##*/}"
    cat "$STUB_JOBS_DIR/$id.json" || exit 1
    ;;
esac
exit "\${STUB_GH_EXIT:-0}"
`

interface Step {
  name?: string
  if?: string
  env?: Record<string, string>
  run?: string
}

interface Workflow {
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: {
    detect: {
      permissions: Record<string, string>
      steps: Step[]
    }
  }
}

function loadWorkflow(): Workflow {
  return load(fs.readFileSync(WORKFLOW, 'utf8')) as Workflow
}

interface JobState {
  status: string
  conclusion?: string | null
}

describe('scripts/ci/cancel-superseded-runs.sh', () => {
  let dir: string
  let jobsDir: string
  let ghLog: string
  let summary: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-superseded-'))
    jobsDir = path.join(dir, 'jobs')
    ghLog = path.join(dir, 'gh.log')
    summary = path.join(dir, 'summary.md')
    fs.mkdirSync(jobsDir)
    fs.writeFileSync(path.join(dir, 'gh'), STUB_GH, { mode: 0o755 })
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    fs.rmSync(ghLog, { force: true })
    fs.rmSync(summary, { force: true })
    fs.rmSync(jobsDir, { recursive: true, force: true })
    fs.mkdirSync(jobsDir)
  })

  const sha = (id: number): string => `${String(id)}`.padEnd(40, 'a')

  /** Writes a run's jobs: a matrix job, and `deploy` when given. */
  function setJobs(id: number, deploy?: JobState): void {
    const jobs: Array<{ name: string } & JobState> = [
      { name: 'test (apps/x)', status: 'completed', conclusion: 'success' },
    ]
    if (deploy) jobs.push({ name: 'deploy', ...deploy })
    fs.writeFileSync(path.join(jobsDir, `${id}.json`), JSON.stringify({ jobs }))
  }

  function run(
    runs: Array<{ id: number; status: string }>,
    { exit = 0, withSummary = false } = {},
  ) {
    const workflowRuns = runs.map(r => ({ ...r, head_sha: sha(r.id) }))
    return spawnSync(SCRIPT, [String(THIS_RUN), 'main', 'push'], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`,
        GH_TOKEN: 'x',
        STUB_GH_LOG: ghLog,
        STUB_RUNS_JSON: JSON.stringify({ workflow_runs: workflowRuns }),
        STUB_JOBS_DIR: jobsDir,
        STUB_GH_EXIT: String(exit),
        ...(withSummary ? { GITHUB_STEP_SUMMARY: summary } : {}),
      },
    })
  }

  const calls = (): string[] =>
    fs.existsSync(ghLog)
      ? fs.readFileSync(ghLog, 'utf8').trim().split('\n')
      : []
  const cancelCalls = (): string[] =>
    calls().filter(c => c.startsWith('run cancel'))

  it('lists runs of the branch and event', () => {
    run([])
    expect(calls()[0]).toContain(
      'actions/workflows/ci.yml/runs?branch=main&event=push&per_page=50',
    )
  })

  it('cancels an older queued run that has no deploy job', () => {
    setJobs(100)
    const result = run([{ id: 100, status: 'queued' }])
    expect(result.status).toBe(0)
    expect(cancelCalls()).toEqual(['run cancel 100'])
    expect(result.stdout).toContain(`cancelled 100 (${sha(100)})`)
  })

  it('keeps an older run whose deploy is in progress', () => {
    setJobs(100, { status: 'in_progress', conclusion: null })
    const result = run([{ id: 100, status: 'in_progress' }])
    expect(result.status).toBe(0)
    expect(cancelCalls()).toEqual([])
    expect(result.stdout).toContain(
      `keeping 100 (${sha(100)}): deploy in_progress`,
    )
  })

  it.each(['success', 'failure'])(
    'keeps an older run whose deploy completed with %s',
    conclusion => {
      setJobs(100, { status: 'completed', conclusion })
      const result = run([{ id: 100, status: 'in_progress' }])
      expect(result.status).toBe(0)
      expect(cancelCalls()).toEqual([])
      expect(result.stdout).toContain(
        `keeping 100 (${sha(100)}): deploy completed`,
      )
    },
  )

  it.each([
    ['completed', 'cancelled'],
    ['completed', 'skipped'],
    ['skipped', null],
  ])(
    'cancels an older run whose deploy is %s/%s (it never ran)',
    (status, conclusion) => {
      setJobs(100, { status, conclusion })
      const result = run([{ id: 100, status: 'in_progress' }])
      expect(result.status).toBe(0)
      expect(cancelCalls()).toEqual(['run cancel 100'])
    },
  )

  it('leaves a newer run untouched', () => {
    setJobs(900)
    const result = run([{ id: 900, status: 'queued' }])
    expect(result.status).toBe(0)
    expect(calls().filter(c => c.includes('/jobs'))).toEqual([])
    expect(cancelCalls()).toEqual([])
  })

  it('leaves a completed run untouched', () => {
    setJobs(100)
    const result = run([{ id: 100, status: 'completed' }])
    expect(result.status).toBe(0)
    expect(calls().filter(c => c.includes('/jobs'))).toEqual([])
    expect(cancelCalls()).toEqual([])
  })

  it('handles a mix of runs', () => {
    setJobs(100)
    setJobs(200, { status: 'in_progress', conclusion: null })
    setJobs(300)
    const result = run([
      { id: 300, status: 'in_progress' },
      { id: 200, status: 'in_progress' },
      { id: 100, status: 'queued' },
      { id: 400, status: 'completed' },
      { id: 600, status: 'queued' },
    ])
    expect(result.status).toBe(0)
    expect(cancelCalls().sort()).toEqual(['run cancel 100', 'run cancel 300'])
  })

  it('warns, exits 0 and cancels nothing when listing runs fails', () => {
    setJobs(100)
    const result = run([{ id: 100, status: 'queued' }], { exit: 1 })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::warning::')
    expect(cancelCalls()).toEqual([])
  })

  it('leaves a run alone when its jobs cannot be listed', () => {
    // No jobs file: the stub's `cat` fails.
    const result = run([{ id: 100, status: 'queued' }])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('::warning::')
    expect(cancelCalls()).toEqual([])
  })

  it('writes one summary line per run when GITHUB_STEP_SUMMARY is set', () => {
    setJobs(100)
    setJobs(200, { status: 'in_progress', conclusion: null })
    const result = run(
      [
        { id: 100, status: 'queued' },
        { id: 200, status: 'in_progress' },
      ],
      { withSummary: true },
    )
    expect(result.status).toBe(0)
    const lines = fs.readFileSync(summary, 'utf8').trim().split('\n')
    expect(lines[0]).toBe('## Superseded runs')
    expect(lines.slice(1).filter(l => l !== '')).toEqual([
      `- cancelled 100 (${sha(100)})`,
      `- keeping 200 (${sha(200)}): deploy in_progress`,
    ])
  })

  it('writes no summary when there is nothing superseded', () => {
    const result = run([], { withSummary: true })
    expect(result.status).toBe(0)
    expect(fs.existsSync(summary)).toBe(false)
  })

  it('exits 2 with usage when called without arguments', () => {
    const result = spawnSync(SCRIPT, [], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})

describe('ci.yml superseded run cancellation', () => {
  it('groups only pull request runs, cancelling in progress', () => {
    const { concurrency } = loadWorkflow()
    expect(concurrency.group).toContain('pull_request')
    expect(concurrency.group).toContain('github.run_id')
    expect(concurrency['cancel-in-progress']).toBe(true)
  })

  it('cancels superseded runs in detect, except on pull requests', () => {
    const steps = loadWorkflow().jobs.detect.steps
    const index = steps.findIndex(s => s.name === 'Cancel superseded runs')
    expect(index).toBeGreaterThan(-1)
    const step = steps[index] as Step
    expect(steps[index - 1]?.name).toBe('Checkout repository')
    expect(step.if).toContain("github.event_name != 'pull_request'")
    expect(step.env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(step.run).toContain('scripts/ci/cancel-superseded-runs.sh')
  })

  it('lets detect cancel runs', () => {
    expect(loadWorkflow().jobs.detect.permissions.actions).toBe('write')
  })
})
