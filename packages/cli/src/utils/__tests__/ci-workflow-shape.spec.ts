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
  with?: Record<string, string>
}

interface Job {
  if?: string
  needs?: string[]
  env?: Record<string, string>
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

function artifactNames(name: string): string[] {
  return (job(name).steps ?? [])
    .filter(s => s.uses?.startsWith('actions/upload-artifact@'))
    .map(s => s.with?.name ?? '')
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

  it('uploads pass markers from check and built markers from build-images', () => {
    expect(artifactNames('check').some(n => n.startsWith('pass-'))).toBe(true)
    expect(
      artifactNames('build-images').some(n => n.startsWith('built-')),
    ).toBe(true)
  })
})
