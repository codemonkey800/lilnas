import * as fs from 'fs'
import { load } from 'js-yaml'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../../../../..')
const WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml')

const GATE_IF = "steps.gates.outputs.ok == 'true'"

interface Step {
  id?: string
  name?: string
  if?: string
  uses?: string
  run?: string
  with?: Record<string, string | boolean>
}

interface Job {
  if?: string
  needs?: string[]
  env?: Record<string, string>
  strategy?: Record<string, unknown>
  steps?: Step[]
}

interface Workflow {
  on: {
    workflow_dispatch: { inputs: Record<string, unknown> }
  }
  jobs: Record<string, Job>
}

const workflow = load(fs.readFileSync(WORKFLOW, 'utf8')) as Workflow

function job(name: string): Job {
  const found = workflow.jobs[name]
  if (!found) throw new Error(`ci.yml has no "${name}" job`)
  return found
}

function step(jobName: string, stepName: string): Step {
  const found = (job(jobName).steps ?? []).find(s =>
    s.name?.startsWith(stepName),
  )
  if (!found) throw new Error(`${jobName} has no "${stepName}" step`)
  return found
}

function artifactNames(name: string): string[] {
  return (job(name).steps ?? [])
    .filter(s => s.uses?.startsWith('actions/upload-artifact@'))
    .map(s => String(s.with?.name ?? ''))
}

describe('ci.yml shape', () => {
  it('replaces test and lint-and-typecheck with a check job', () => {
    expect(workflow.jobs).not.toHaveProperty('test')
    expect(workflow.jobs).not.toHaveProperty('lint-and-typecheck')
    expect(Object.keys(job('check').env ?? {}).sort()).toEqual([
      'TURBO_API',
      'TURBO_REMOTE_CACHE_SIGNATURE_KEY',
      'TURBO_TEAM',
      'TURBO_TOKEN',
    ])
  })

  it.each(['build-images', 'deploy'])(
    '%s does not gate on another job result, but needs check',
    name => {
      const { if: condition, needs } = job(name)
      expect(condition).not.toContain('needs.check.result')
      expect(condition).not.toContain('needs.build-images.result')
      expect(needs).toContain('check')
    },
  )

  it('summary waits for all five jobs', () => {
    expect(job('summary').needs).toEqual([
      'detect',
      'check',
      'base-images',
      'build-images',
      'deploy',
    ])
  })

  it('keeps the four workflow_dispatch inputs', () => {
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      'dry_run',
      'full',
      'base',
      'build_base_images',
    ])
  })

  it('gates every build-images step after the gates step', () => {
    const steps = job('build-images').steps ?? []
    const gatesAt = steps.findIndex(s => s.id === 'gates')
    expect(gatesAt).toBeGreaterThan(-1)

    const after = steps.slice(gatesAt + 1)
    expect(after.length).toBeGreaterThan(0)
    for (const step of after) {
      expect({ name: step.name, if: step.if }).toEqual({
        name: step.name,
        if: GATE_IF,
      })
    }
  })

  it('builds up to 12 images at once', () => {
    expect(job('build-images').strategy?.['max-parallel']).toBe(12)
  })

  it('disables the buildx post-step cleanup on every setup-buildx step', () => {
    const buildx = Object.values(workflow.jobs)
      .flatMap(j => j.steps ?? [])
      .filter(s => s.uses?.startsWith('docker/setup-buildx-action@'))
    expect(buildx.length).toBeGreaterThan(0)
    for (const step of buildx) {
      expect(step.with?.cleanup).toBe(false)
    }
  })

  it('passes the four Turbo remote cache secrets to the image build', () => {
    const secrets = String(step('build-images', 'Build and push').with?.secrets)
    const ids = secrets
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.trim().split('=')[0])
    expect(ids.sort()).toEqual([
      'TURBO_API',
      'TURBO_REMOTE_CACHE_SIGNATURE_KEY',
      'TURBO_TEAM',
      'TURBO_TOKEN',
    ])
  })

  it('builds the checked package itself, not only its dependencies', () => {
    const run = step('check', 'Build dependencies').run ?? ''
    const filter = run.match(/--filter="([^"]+)"/)?.[1]
    expect(filter).not.toContain('^')
    expect(filter).toBe('{./${PACKAGE}}...')
    expect(run).toContain('pnpm install --frozen-lockfile --offline')
  })

  it('uploads pass markers from check and built markers from build-images', () => {
    expect(artifactNames('check').some(n => n.startsWith('pass-'))).toBe(true)
    expect(
      artifactNames('build-images').some(n => n.startsWith('built-')),
    ).toBe(true)
  })
})
