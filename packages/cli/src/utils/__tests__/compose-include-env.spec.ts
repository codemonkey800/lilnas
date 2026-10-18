import * as fs from 'fs'
import yaml from 'js-yaml'
import * as path from 'path'

import { gitTrackedFiles, listEncryptedEnvFiles } from '../secrets'

const ROOT = path.resolve(__dirname, '../../../../..')

/** `${VAR}`, `${VAR:-default}` etc., skipping `$${…}` escapes. */
const INTERPOLATION = /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g

/** Keys only: an encrypted file's values are never read into the test. */
const ENV_KEY = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

interface IncludeEntry {
  name: string
  file: string
  envFiles: string[]
}

/**
 * Each `include:` entry of `composeFile` with the env files Compose
 * interpolates it from: its `env_file`, or `.env` in its project directory
 * (the included file's directory unless `project_directory` is set).
 */
function includeEntries(composeFile: string): IncludeEntry[] {
  const baseDir = path.dirname(composeFile)
  const doc = yaml.load(fs.readFileSync(composeFile, 'utf8')) as {
    include?: unknown[]
  }

  return (doc.include ?? []).map(entry => {
    const spec =
      typeof entry === 'string'
        ? { path: entry }
        : (entry as {
            path: string
            project_directory?: string
            env_file?: string | string[]
          })
    const file = path.resolve(baseDir, spec.path)
    const projectDir = spec.project_directory
      ? path.resolve(baseDir, spec.project_directory)
      : path.dirname(file)
    const envFiles =
      spec.env_file === undefined
        ? [path.join(projectDir, '.env')]
        : [spec.env_file].flat().map(f => path.resolve(baseDir, f))

    return { name: path.relative(ROOT, file), file, envFiles }
  })
}

function envKeys(file: string): Set<string> {
  return new Set(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map(line => ENV_KEY.exec(line)?.[1])
      .filter((key): key is string => key !== undefined),
  )
}

function interpolatedVars(file: string): Set<string> {
  const content = fs.readFileSync(file, 'utf8')
  return new Set(
    [...content.matchAll(INTERPOLATION)].map(match => match[1] as string),
  )
}

describe('root docker-compose.yml includes', () => {
  const encrypted = new Set(listEncryptedEnvFiles(ROOT, gitTrackedFiles(ROOT)))
  const entries = includeEntries(path.join(ROOT, 'docker-compose.yml'))

  it('finds the include entries', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries.map(entry => [entry.name, entry] as const))(
    '%s interpolates no variable from an encrypted env file',
    (_name, entry) => {
      const vars = interpolatedVars(entry.file)
      const leaks = entry.envFiles
        .filter(envFile => encrypted.has(envFile))
        .flatMap(envFile =>
          [...envKeys(envFile)]
            .filter(key => vars.has(key))
            .map(key => `${key} from ${path.relative(ROOT, envFile)}`),
        )

      expect(leaks).toEqual([])
    },
  )

  it('interpolates infra/immich.yml from the decrypted infra/.env', () => {
    const immich = entries.find(entry => entry.name === 'infra/immich.yml')

    expect(immich?.envFiles.map(f => path.relative(ROOT, f))).toEqual([
      'infra/.env.decrypted',
    ])
  })
})
