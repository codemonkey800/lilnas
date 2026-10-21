import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { readComposeTree } from '../ci-detect'
import { getStorageMounts } from '../compose'
import { listInfraServices } from '../services'
import { loadYaml } from '../yaml'

let mockRoot = ''

jest.mock('../paths', () => ({
  ...jest.requireActual('../paths'),
  getMonorepoRoot: () => mockRoot,
}))

/** js-yaml 4's `load` returned `undefined` for these; v5's throws. */
const EMPTY_CONTENTS = ['', '  \n\n', '# only a comment\n']

let tmp: string

function write(rel: string, content: string): void {
  const file = path.join(tmp, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lilnas-empty-yaml-'))
  mockRoot = tmp
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('loadYaml', () => {
  it.each(EMPTY_CONTENTS)('returns undefined for %j', content => {
    expect(loadYaml(content)).toBeUndefined()
  })

  it('parses a single document', () => {
    expect(loadYaml('a: 1\n')).toEqual({ a: 1 })
  })

  it('still throws on a multi-document stream', () => {
    expect(() => loadYaml('a: 1\n---\nb: 2\n')).toThrow()
  })
})

describe.each(EMPTY_CONTENTS)('empty compose file %j', content => {
  it('getStorageMounts finds no includes when docker-compose.yml is empty', () => {
    write('docker-compose.yml', content)

    expect(getStorageMounts()).toEqual([])
  })

  it('getStorageMounts finds no mounts in an empty included file', () => {
    write('docker-compose.yml', 'include:\n  - ./infra/empty.yml\n')
    write('infra/empty.yml', content)

    expect(getStorageMounts()).toEqual([])
  })

  it('listInfraServices finds no includes when docker-compose.yml is empty', () => {
    write('docker-compose.yml', content)

    expect(listInfraServices(tmp)).toEqual([])
  })

  it('readComposeTree finds no includes when docker-compose.yml is empty', () => {
    write('docker-compose.yml', content)

    expect(readComposeTree(tmp)).toEqual({
      file: 'docker-compose.yml',
      includes: [],
      services: [],
    })
  })

  it('readComposeTree finds no services in an empty included file', () => {
    write('docker-compose.yml', 'include:\n  - ./infra/empty.yml\n')
    write('infra/empty.yml', content)

    const tree = readComposeTree(tmp)

    expect(tree.includes).toEqual([
      { file: 'infra/empty.yml', envFile: undefined, services: [] },
    ])
    expect(tree.services).toEqual([])
  })
})
