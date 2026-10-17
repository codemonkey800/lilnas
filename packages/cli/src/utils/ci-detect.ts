import * as fs from 'fs'
import yaml from 'js-yaml'
import * as path from 'path'

/**
 * Turns a `git diff --name-only` listing into the build/deploy plan the
 * push-to-deploy workflow feeds to its jobs. Everything here is pure: the
 * `ci detect` command gathers the inputs (diff, turbo, root compose path) and
 * `detect()` does the rest from the compose tree on disk.
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

export interface DetectInputs {
  /** Absolute monorepo root. */
  root: string
  /** Repo-relative changed files (`git diff --name-only base..head`). */
  changedFiles: string[]
  /** Repo-relative package dirs from `turbo ls --affected`. */
  affectedPackages?: string[]
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

/** Dirs under `apps/` and `packages/` whose `package.json` has a `test` script. */
export function listTestPackages(root: string): string[] {
  const dirs: string[] = []

  for (const base of ['apps', 'packages']) {
    const baseDir = path.join(root, base)
    if (!fs.existsSync(baseDir)) continue

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const pkgFile = path.join(baseDir, entry.name, 'package.json')
      if (!fs.existsSync(pkgFile)) continue

      try {
        const pkg: unknown = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
        if (isDict(pkg) && isDict(pkg.scripts) && 'test' in pkg.scripts) {
          dirs.push(`${base}/${entry.name}`)
        }
      } catch {
        // Not valid JSON — not a testable package.
      }
    }
  }

  return dirs.sort()
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
    affectedPackages = [],
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

  // App images: affected package, Dockerfile, its directory, or a non-root context.
  for (const image of allImages) {
    const dockerfileDir = path.dirname(image.dockerfile)
    const hit =
      affectedPackages.some(pkg => path.normalize(pkg) === dockerfileDir) ||
      changedFiles.some(
        file =>
          file === image.dockerfile ||
          isUnder(file, dockerfileDir) ||
          (image.context !== '.' && isUnder(file, image.context)),
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
