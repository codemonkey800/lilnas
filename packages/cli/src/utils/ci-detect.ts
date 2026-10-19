import * as fs from 'fs'
import yaml from 'js-yaml'
import * as path from 'path'

/**
 * Turns a `git diff --name-only` listing into the build/deploy plan the
 * push-to-deploy workflow feeds to its jobs. Everything here is pure: the
 * `ci detect` command gathers the inputs (diff, workspace packages, root
 * compose path) and `detect()` does the rest from the compose tree on disk.
 *
 * App images follow *runtime* workspace dependencies only (`dependencies`,
 * not `devDependencies`): apps list `@lilnas/cli` as a dev dependency
 * and no Dockerfile runs the CLI, so a CLI-only change must
 * not rebuild anything.
 */

export interface ImageBuild {
  /** Image suffix after `ghcr.io/codemonkey800/lilnas-`, e.g. `auth`. */
  name: string
  /** Tag-less image reference, e.g. `ghcr.io/codemonkey800/lilnas-auth`. */
  image: string
  /** Repo-relative build context (`.` for the repo root). */
  context: string
  /** Repo-relative Dockerfile path. */
  dockerfile: string
  /** Compose services that run this image. */
  services: string[]
}

export interface DetectResult {
  /** Treat as "everything changed". */
  full: boolean
  /** Rebuild and push the base images before any app image. */
  baseImages: boolean
  /** App images to build and push, sorted by name. */
  images: ImageBuild[]
  /** Services whose image was rebuilt: `compose pull` then `up -d`. */
  pull: string[]
  /** Services to `up -d` (compose or env change). */
  up: string[]
  /** Services to `up -d --force-recreate` (bind-mounted config changed). */
  forceRecreate: string[]
  /** An encrypted env file changed. */
  decrypt: boolean
  /** `apps/x` / `packages/y` dirs with a `test` script that have a change. */
  testPackages: string[]
  changedFiles: string[]
}

export interface WorkspacePackage {
  /** Repo-relative package dir, e.g. `apps/auth`. */
  dir: string
  /** `name` from `package.json`, e.g. `@lilnas/auth`. */
  name: string
  /** Workspace package names from `dependencies` only. */
  runtimeDeps: string[]
}

export interface DetectInputs {
  /** Absolute monorepo root. */
  root: string
  /** Repo-relative changed files (`git diff --name-only base..head`). */
  changedFiles: string[]
  /** Workspace packages; read from disk via `readWorkspacePackages` when omitted. */
  workspacePackages?: WorkspacePackage[]
  /** Force the "everything changed" plan (unknown base, `--full`). */
  full?: boolean
  /** Root compose file relative to `root`. */
  composeFile?: string
}

export interface ComposeService {
  name: string
  /** Repo-relative compose file that defines the service. */
  file: string
  image?: string
  build?: { context: string; dockerfile: string }
  /** Repo-relative env files (as referenced, e.g. `apps/auth/.env.prod.decrypted`). */
  envFiles: string[]
  /** Bind-mount sources: repo-relative when inside the repo, else absolute. */
  binds: string[]
}

export interface ComposeInclude {
  /** Repo-relative included compose file. */
  file: string
  /** Repo-relative include-level `env_file`, if any. */
  envFile?: string
  services: ComposeService[]
}

export interface ComposeTree {
  file: string
  includes: ComposeInclude[]
  services: ComposeService[]
}

export const IMAGE_PREFIX = 'ghcr.io/codemonkey800/lilnas-'

const BASE_IMAGES_DIR = 'infra/base-images'
const DEV_BASE_IMAGE = `${BASE_IMAGES_DIR}/lilnas-dev.Dockerfile`
const WORKFLOWS_DIR = '.github/workflows'
const DEFAULT_COMPOSE_FILE = 'docker-compose.yml'
const HOST_NATIVE_SERVICES = new Set(['tdr-code'])
const DECRYPTED_SUFFIX = '.decrypted'
const BASE_IMAGE_FROM = /^\s*FROM\s+ghcr\.io\/codemonkey800\/lilnas-/m
const WORKSPACE_DIRS = ['apps', 'packages']
/** Files every image's build reads; a change rebuilds all of them. */
const GLOBAL_BUILD_INPUTS = new Set([
  'pnpm-lock.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  '.npmrc',
  'turbo.json',
])

type Dict = Record<string, unknown>

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

/** `a` equals `b`, or one is a directory containing the other. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/** `file` is `dir` itself or lives under it. */
function isUnder(file: string, dir: string): boolean {
  return dir === '.' || file === dir || file.startsWith(`${dir}/`)
}

/**
 * Resolves `target` against the repo-relative `dir` into a repo-relative path
 * (`.` for the root); paths outside the repo stay absolute.
 */
function resolveFrom(root: string, dir: string, target: string): string {
  const abs = path.isAbsolute(target) ? target : path.resolve(root, dir, target)
  const rel = path.relative(root, abs)
  if (rel === '') return '.'
  return rel.startsWith('..') ? abs : rel
}

/** Resolves `target` against the directory of the compose file `fromFile`. */
function repoRelative(root: string, fromFile: string, target: string): string {
  return resolveFrom(root, path.dirname(fromFile), target)
}

function readYaml(file: string): Dict {
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  return isDict(doc) ? doc : {}
}

function parseBuild(
  root: string,
  file: string,
  build: unknown,
): ComposeService['build'] | undefined {
  let context: string | undefined
  let dockerfile: string | undefined

  if (typeof build === 'string') {
    context = build
  } else if (isDict(build)) {
    if (typeof build.context === 'string') context = build.context
    if (typeof build.dockerfile === 'string') dockerfile = build.dockerfile
  } else {
    return undefined
  }

  const contextRel = repoRelative(root, file, context ?? '.')
  // A Dockerfile path is relative to the build context, not the compose file.
  const dockerfileRel = resolveFrom(
    root,
    contextRel,
    dockerfile ?? 'Dockerfile',
  )

  return { context: contextRel, dockerfile: dockerfileRel }
}

function parseEnvFiles(root: string, file: string, envFile: unknown): string[] {
  const refs: string[] = []
  for (const entry of asList(envFile)) {
    if (typeof entry === 'string') {
      refs.push(entry)
    } else if (isDict(entry) && typeof entry.path === 'string') {
      refs.push(entry.path)
    }
  }
  return refs.map(ref => repoRelative(root, file, ref))
}

function isBindSource(source: string): boolean {
  return (
    source.startsWith('.') || source.startsWith('/') || source.startsWith('~')
  )
}

function parseBinds(root: string, file: string, volumes: unknown): string[] {
  const sources: string[] = []
  for (const entry of asList(volumes)) {
    if (typeof entry === 'string') {
      const [source = '', target] = entry.split(':')
      if (target && isBindSource(source)) sources.push(source)
    } else if (isDict(entry) && typeof entry.source === 'string') {
      if (entry.type === 'bind' || isBindSource(entry.source)) {
        sources.push(entry.source)
      }
    }
  }
  return sources.map(source => repoRelative(root, file, source))
}

function parseServices(root: string, file: string): ComposeService[] {
  const doc = readYaml(path.join(root, file))
  if (!isDict(doc.services)) return []

  return Object.entries(doc.services).flatMap(([name, def]) => {
    if (!isDict(def)) return []
    return [
      {
        name,
        file,
        image: typeof def.image === 'string' ? def.image : undefined,
        build: parseBuild(root, file, def.build),
        envFiles: parseEnvFiles(root, file, def.env_file),
        binds: parseBinds(root, file, def.volumes),
      },
    ]
  })
}

/**
 * Parses the root compose file's `include:` list and every included file's
 * `services`, with all paths normalised to repo-relative.
 */
export function readComposeTree(
  root: string,
  composeFile = DEFAULT_COMPOSE_FILE,
): ComposeTree {
  const doc = readYaml(path.join(root, composeFile))
  const includes: ComposeInclude[] = []

  for (const entry of asList(doc.include)) {
    let file: string | undefined
    let envFile: string | undefined

    if (typeof entry === 'string') {
      file = entry
    } else if (isDict(entry) && typeof entry.path === 'string') {
      file = entry.path
      if (typeof entry.env_file === 'string') envFile = entry.env_file
    }

    if (!file) continue

    const fileRel = repoRelative(root, composeFile, file)
    includes.push({
      file: fileRel,
      envFile: envFile ? repoRelative(root, composeFile, envFile) : undefined,
      services: parseServices(root, fileRel),
    })
  }

  return {
    file: composeFile,
    includes,
    services: includes.flatMap(include => include.services),
  }
}

/** Strips the tag from an image reference: `repo/name:tag` → `repo/name`. */
function imageRepo(image: string): string {
  const slash = image.lastIndexOf('/')
  const colon = image.indexOf(':', slash + 1)
  return colon === -1 ? image : image.slice(0, colon)
}

/**
 * The locally built images: services with both an `image:` under
 * `ghcr.io/codemonkey800/lilnas-` and a `build:`, grouped by image name.
 */
export function listImages(tree: ComposeTree): ImageBuild[] {
  const byName = new Map<string, ImageBuild>()

  for (const service of tree.services) {
    if (HOST_NATIVE_SERVICES.has(service.name)) continue
    if (!service.image?.startsWith(IMAGE_PREFIX) || !service.build) continue

    const image = imageRepo(service.image)
    const name = image.slice(IMAGE_PREFIX.length)
    const existing = byName.get(name)

    if (existing) {
      existing.services = unique([...existing.services, service.name])
    } else {
      byName.set(name, {
        name,
        image,
        context: service.build.context,
        dockerfile: service.build.dockerfile,
        services: [service.name],
      })
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Parsed `apps/*` / `packages/*` package.json files, keyed by repo-relative dir. */
function readPackageManifests(root: string): Map<string, Dict> {
  const manifests = new Map<string, Dict>()

  for (const base of WORKSPACE_DIRS) {
    const baseDir = path.join(root, base)
    if (!fs.existsSync(baseDir)) continue

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const pkgFile = path.join(baseDir, entry.name, 'package.json')
      if (!fs.existsSync(pkgFile)) continue

      try {
        const pkg: unknown = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
        if (isDict(pkg)) manifests.set(`${base}/${entry.name}`, pkg)
      } catch {
        // Not valid JSON — not a workspace package.
      }
    }
  }

  return manifests
}

/** Dirs under `apps/` and `packages/` whose `package.json` has a `test` script. */
export function listTestPackages(root: string): string[] {
  const dirs: string[] = []
  for (const [dir, pkg] of readPackageManifests(root)) {
    if (isDict(pkg.scripts) && 'test' in pkg.scripts) dirs.push(dir)
  }
  return dirs.sort()
}

/**
 * Every `apps/*` / `packages/*` package with its runtime workspace deps: a
 * `dependencies` entry whose spec starts with `workspace:` or whose name is
 * another workspace package. `devDependencies`, `peerDependencies` and
 * `optionalDependencies` are ignored on purpose — they are not image inputs.
 */
export function readWorkspacePackages(root: string): WorkspacePackage[] {
  const manifests = readPackageManifests(root)
  const names = new Set<string>()
  for (const pkg of manifests.values()) {
    if (typeof pkg.name === 'string') names.add(pkg.name)
  }

  const packages: WorkspacePackage[] = []
  for (const [dir, pkg] of manifests) {
    if (typeof pkg.name !== 'string') continue
    const runtimeDeps: string[] = []
    if (isDict(pkg.dependencies)) {
      for (const [dep, spec] of Object.entries(pkg.dependencies)) {
        const isWorkspace =
          (typeof spec === 'string' && spec.startsWith('workspace:')) ||
          names.has(dep)
        if (isWorkspace) runtimeDeps.push(dep)
      }
    }
    packages.push({ dir, name: pkg.name, runtimeDeps: runtimeDeps.sort() })
  }

  return packages.sort((a, b) => a.dir.localeCompare(b.dir))
}

/**
 * Dirs whose files are inputs to the package at `dir`: itself plus the
 * transitive closure of its runtime workspace deps. Cycle-safe.
 */
function runtimeInputDirs(dir: string, packages: WorkspacePackage[]): string[] {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const byDir = new Map(packages.map(pkg => [pkg.dir, pkg]))
  const seen = new Set<string>([dir])
  const queue = [byDir.get(dir)].filter(
    (pkg): pkg is WorkspacePackage => pkg !== undefined,
  )

  while (queue.length > 0) {
    const pkg = queue.shift() as WorkspacePackage
    for (const depName of pkg.runtimeDeps) {
      const dep = byName.get(depName)
      if (dep && !seen.has(dep.dir)) {
        seen.add(dep.dir)
        queue.push(dep)
      }
    }
  }

  return [...seen]
}

function dockerfileUsesBaseImage(root: string, dockerfile: string): boolean {
  const file = path.join(root, dockerfile)
  if (!fs.existsSync(file)) return false
  return BASE_IMAGE_FROM.test(fs.readFileSync(file, 'utf8'))
}

function isIgnoredComposeFile(file: string): boolean {
  return file.endsWith('.dev.yml') || file === 'docker-compose.dev.yml'
}

/** The encrypted file a compose `env_file` reference maps to, or `null` for a plain one. */
function encryptedNameFor(envFileRef: string): string | null {
  return envFileRef.endsWith(DECRYPTED_SUFFIX)
    ? envFileRef.slice(0, -DECRYPTED_SUFFIX.length)
    : null
}

/**
 * Builds the plan. Rules are applied in order and unioned; `full` short-
 * circuits to every image, every service and every test package.
 */
export function detect(inputs: DetectInputs): DetectResult {
  const {
    root,
    composeFile = DEFAULT_COMPOSE_FILE,
    workspacePackages = readWorkspacePackages(root),
  } = inputs
  const changedFiles = unique(
    inputs.changedFiles.map(file => file.trim()).filter(Boolean),
  )
  const tree = readComposeTree(root, composeFile)
  const allImages = listImages(tree)
  const allTestPackages = listTestPackages(root)
  const serviceNames = unique(tree.services.map(service => service.name))

  const full =
    inputs.full === true ||
    changedFiles.some(
      file => file.startsWith(`${WORKFLOWS_DIR}/`) || file === composeFile,
    )

  if (full) {
    const pull = unique(allImages.flatMap(image => image.services))
    return {
      full: true,
      baseImages: true,
      images: allImages,
      pull,
      up: serviceNames.filter(name => !pull.includes(name)),
      forceRecreate: [],
      decrypt: true,
      testPackages: allTestPackages,
      changedFiles,
    }
  }

  const images = new Set<string>()
  const up = new Set<string>()
  const forceRecreate = new Set<string>()
  let decrypt = false

  // Base images: rebuild them and every app image built FROM one.
  const baseImages = changedFiles.some(
    file => file.startsWith(`${BASE_IMAGES_DIR}/`) && file !== DEV_BASE_IMAGE,
  )
  if (baseImages) {
    for (const image of allImages) {
      if (dockerfileUsesBaseImage(root, image.dockerfile))
        images.add(image.name)
    }
  }

  // Global build inputs (lockfile, root manifest, …) → every image.
  if (changedFiles.some(file => GLOBAL_BUILD_INPUTS.has(file))) {
    for (const image of allImages) images.add(image.name)
  }

  // App images: own package dir or a runtime workspace dep's dir (transitive),
  // the Dockerfile, its directory, or a non-root build context.
  for (const image of allImages) {
    const dockerfileDir = path.dirname(image.dockerfile)
    const inputDirs = runtimeInputDirs(dockerfileDir, workspacePackages)
    const hit = changedFiles.some(
      file =>
        file === image.dockerfile ||
        isUnder(file, dockerfileDir) ||
        (image.context !== '.' && isUnder(file, image.context)) ||
        inputDirs.some(dir => isUnder(file, dir)),
    )
    if (hit) images.add(image.name)
  }

  // Compose file changed → `up` every service it defines.
  for (const include of tree.includes) {
    if (isIgnoredComposeFile(include.file)) continue
    if (changedFiles.includes(include.file)) {
      for (const service of include.services) up.add(service.name)
    }
  }

  // Bind-mounted path changed → force-recreate the service.
  for (const service of tree.services) {
    if (
      service.binds.some(bind =>
        changedFiles.some(file => overlaps(file, bind)),
      )
    ) {
      forceRecreate.add(service.name)
    }
  }

  // Env file changed → decrypt and `up` whoever loads it.
  for (const service of tree.services) {
    for (const ref of service.envFiles) {
      const encrypted = encryptedNameFor(ref)
      if (encrypted && changedFiles.includes(encrypted)) {
        decrypt = true
        up.add(service.name)
      } else if (!encrypted && changedFiles.includes(ref)) {
        up.add(service.name)
      }
    }
  }
  for (const include of tree.includes) {
    if (!include.envFile) continue
    const encrypted = encryptedNameFor(include.envFile)
    if (encrypted && changedFiles.includes(encrypted)) {
      decrypt = true
      for (const service of include.services) up.add(service.name)
    }
  }

  const testPackages = allTestPackages.filter(pkg =>
    changedFiles.some(file => isUnder(file, pkg)),
  )

  const selectedImages = allImages.filter(image => images.has(image.name))
  const pull = unique(selectedImages.flatMap(image => image.services))

  for (const name of pull) {
    up.delete(name)
    forceRecreate.delete(name)
  }
  for (const name of forceRecreate) up.delete(name)

  return {
    full: false,
    baseImages,
    images: selectedImages,
    pull,
    up: unique(up),
    forceRecreate: unique(forceRecreate),
    decrypt,
    testPackages,
    changedFiles,
  }
}
