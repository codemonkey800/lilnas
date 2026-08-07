import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

import {
  DEFAULT_APPS_DIR,
  DEFAULT_INFRA_DIR,
} from 'src/services/service-registry.service'

// Guards S1's narrowed, per-file bind mounts (see deploy.yml/deploy.dev.yml's
// own comment on why a directory-level mount was replaced with an explicit
// list): every apps/*/deploy.yml and infra/*.yml the service registry might
// scan must have a matching mount line in BOTH compose files, or a newly
// added compose file silently falls out of the registry with only a logged
// warning to notice — see service-registry.service.ts's onWarn. This turns
// that "someone must remember to add a mount line" step into a failing test.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const APPS_DIR = path.join(REPO_ROOT, 'apps')
const INFRA_DIR = path.join(REPO_ROOT, 'infra')

type ComposeFile = { services?: Record<string, { volumes?: string[] }> }

function readMountTargets(composeFilePath: string): Set<string> {
  const doc = parse(fs.readFileSync(composeFilePath, 'utf-8')) as ComposeFile
  const volumes = doc.services?.auth?.volumes ?? []
  return new Set(
    volumes
      .map(volume => volume.split(':')[1])
      .filter((target): target is string => Boolean(target)),
  )
}

const deployYmlTargets = readMountTargets(
  path.join(APPS_DIR, 'auth', 'deploy.yml'),
)
const deployDevYmlTargets = readMountTargets(
  path.join(APPS_DIR, 'auth', 'deploy.dev.yml'),
)

const appDeployRelPaths = fs
  .readdirSync(APPS_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(entry.name, 'deploy.yml'))
  .filter(relPath => fs.existsSync(path.join(APPS_DIR, relPath)))

const infraRelPaths = fs
  .readdirSync(INFRA_DIR, { withFileTypes: true })
  .filter(
    entry =>
      entry.isFile() &&
      entry.name.endsWith('.yml') &&
      !entry.name.endsWith('.dev.yml'),
  )
  .map(entry => entry.name)

describe('compose mount coverage (S1)', () => {
  // Sanity checks against the enumeration itself — a bug here would make
  // every it.each below vacuously pass on an empty list.
  it('found at least one app deploy.yml and one infra yml to guard', () => {
    expect(appDeployRelPaths.length).toBeGreaterThan(0)
    expect(infraRelPaths.length).toBeGreaterThan(0)
  })

  it.each(appDeployRelPaths)(
    'mounts apps/%s into both deploy.yml and deploy.dev.yml',
    relPath => {
      const target = `${DEFAULT_APPS_DIR}/${relPath}`
      expect(deployYmlTargets.has(target)).toBe(true)
      expect(deployDevYmlTargets.has(target)).toBe(true)
    },
  )

  it.each(infraRelPaths)(
    'mounts infra/%s into both deploy.yml and deploy.dev.yml',
    fileName => {
      const target = `${DEFAULT_INFRA_DIR}/${fileName}`
      expect(deployYmlTargets.has(target)).toBe(true)
      expect(deployDevYmlTargets.has(target)).toBe(true)
    },
  )
})
