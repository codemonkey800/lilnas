import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../../../../..')
const GATE_CHECK = path.join(ROOT, 'scripts/ci/gate-check.sh')
const DEPLOY_COMMAND = path.join(ROOT, 'scripts/ci/deploy-command.sh')

const SHA = 'a'.repeat(40)

interface Plan {
  images: Array<{ name: string; services: string[]; gates: string[] }>
  pull: string[]
  up: string[]
  forceRecreate: string[]
  decrypt: boolean
  decryptServices: string[]
  full: boolean
}

const PLAN: Plan = {
  images: [
    {
      name: 'auth',
      services: ['auth'],
      gates: ['apps/auth', 'packages/utils'],
    },
    {
      name: 'tdr-bot',
      services: ['tdr-bot'],
      gates: ['apps/tdr-bot', 'packages/utils'],
    },
  ],
  pull: ['auth', 'tdr-bot'],
  up: ['tdr-bot-db', 'storage'],
  forceRecreate: ['prometheus'],
  decrypt: true,
  decryptServices: ['tdr-bot', 'tdr-bot-db'],
  full: false,
}

const ALL_MARKERS = [
  'pass-apps-auth',
  'pass-apps-tdr-bot',
  'pass-packages-utils',
  'built-auth',
  'built-tdr-bot',
]

describe('scripts/ci/gate-check.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function run(args: string[]) {
    return spawnSync(GATE_CHECK, args, {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    })
  }

  it('exits 2 with usage when the markers dir is absent', () => {
    const result = run([])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage: gate-check.sh')
    expect(result.stdout).toBe('')
  })

  it('prints nothing when there are no packages', () => {
    const result = run([dir])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints nothing when every pass marker is present', () => {
    fs.writeFileSync(path.join(dir, 'pass-apps-theater'), '')
    fs.writeFileSync(path.join(dir, 'pass-packages-utils'), '')
    const result = run([dir, 'apps/theater', 'packages/utils'])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints the missing packages in argument order', () => {
    fs.writeFileSync(path.join(dir, 'pass-packages-utils'), '')
    const result = run([dir, 'apps/theater', 'packages/utils', 'apps/auth'])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('apps/theater\napps/auth\n')
  })

  it('treats a markers dir that does not exist as all missing', () => {
    const result = run([path.join(dir, 'nope'), 'apps/theater'])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('apps/theater\n')
  })
})

describe('scripts/ci/deploy-command.sh', () => {
  let dir: string
  let markers: string
  let summary: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-command-'))
    markers = path.join(dir, 'markers')
    summary = path.join(dir, 'summary.md')
    fs.mkdirSync(markers)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** Writes every marker except the ones named in `without`. */
  function writeMarkers(without: string[] = []): void {
    for (const name of ALL_MARKERS.filter(m => !without.includes(m))) {
      fs.writeFileSync(path.join(markers, name), '')
    }
  }

  function run(
    plan: Partial<Plan> | undefined,
    env: Record<string, string> = {},
    args: string[] = [markers],
  ) {
    return spawnSync(DEPLOY_COMMAND, args, {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        SHA,
        GITHUB_STEP_SUMMARY: summary,
        ...(plan ? { PLAN: JSON.stringify({ ...PLAN, ...plan }) } : {}),
        ...env,
      },
    })
  }

  const readSummary = (): string =>
    fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : ''

  it('prints the full command in PLAN order when every marker is present', () => {
    writeMarkers()
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `deploy ${SHA} --decrypt --pull auth,tdr-bot --up tdr-bot-db,storage --force-recreate prometheus\n`,
    )
    expect(readSummary()).toBe('')
  })

  it('drops an image whose checks are missing and keeps decrypt for tdr-bot-db', () => {
    writeMarkers(['pass-apps-tdr-bot'])
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `deploy ${SHA} --decrypt --pull auth --up tdr-bot-db,storage --force-recreate prometheus\n`,
    )
    expect(readSummary()).toBe(
      [
        '### Held back',
        '',
        '| image | services | reason |',
        '| --- | --- | --- |',
        '| tdr-bot | tdr-bot | checks failed or missing: apps/tdr-bot |',
        '',
      ].join('\n'),
    )
  })

  it('drops an image that was not built', () => {
    writeMarkers(['built-auth'])
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `deploy ${SHA} --decrypt --pull tdr-bot --up tdr-bot-db,storage --force-recreate prometheus\n`,
    )
    expect(readSummary()).toContain('| auth | auth | image not built |')
  })

  it('holds back every image sharing a missing gate', () => {
    writeMarkers(['pass-packages-utils'])
    const result = run({})
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `deploy ${SHA} --decrypt --up tdr-bot-db,storage --force-recreate prometheus\n`,
    )
    const table = readSummary()
    expect(table).toContain(
      '| auth | auth | checks failed or missing: packages/utils |',
    )
    expect(table).toContain(
      '| tdr-bot | tdr-bot | checks failed or missing: packages/utils |',
    )
  })

  it('drops --decrypt when only held-back services need it', () => {
    writeMarkers(['pass-packages-utils'])
    const result = run({ up: [], decryptServices: ['tdr-bot'] })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`deploy ${SHA} --force-recreate prometheus\n`)
  })

  it('adds --dry-run right after the sha', () => {
    writeMarkers()
    const result = run({}, { DRY_RUN: 'true' })
    expect(result.stdout).toBe(
      `deploy ${SHA} --dry-run --decrypt --pull auth,tdr-bot --up tdr-bot-db,storage --force-recreate prometheus\n`,
    )
  })

  it('prints --full when the plan is full and nothing is held back', () => {
    writeMarkers()
    const result = run({ full: true })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`deploy ${SHA} --full\n`)
  })

  it('prints --dry-run --full for a dry full deploy', () => {
    writeMarkers()
    const result = run({ full: true }, { DRY_RUN: 'true' })
    expect(result.stdout).toBe(`deploy ${SHA} --dry-run --full\n`)
  })

  it('prints --full when the dispatch input asks for it', () => {
    writeMarkers()
    const result = run({ full: false }, { INPUT_FULL: 'true' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`deploy ${SHA} --full\n`)
  })

  it('falls back to explicit lists when a full deploy has an image held back', () => {
    writeMarkers(['built-auth'])
    const result = run({ full: true })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      `deploy ${SHA} --decrypt --pull tdr-bot --up tdr-bot-db,storage --force-recreate prometheus\n`,
    )
    expect(result.stdout).not.toContain('--full')
  })

  it('prints nothing when there is nothing to deploy', () => {
    writeMarkers()
    const result = run({
      images: [],
      pull: [],
      up: [],
      forceRecreate: [],
      decrypt: false,
      decryptServices: [],
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(readSummary()).toBe('')
  })

  it('works without GITHUB_STEP_SUMMARY', () => {
    writeMarkers(['built-auth'])
    const result = run({}, { GITHUB_STEP_SUMMARY: '' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--pull tdr-bot')
    expect(readSummary()).toBe('')
  })

  it('exits 2 with usage when PLAN is not set', () => {
    const result = run(undefined)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
    expect(result.stdout).toBe('')
  })

  it('exits 2 with usage when the markers dir is absent', () => {
    const result = run({}, {}, [])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})
