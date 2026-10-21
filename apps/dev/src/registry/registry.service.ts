import { env } from '@lilnas/utils/env'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import fs from 'fs/promises'
import path from 'path'

import { EnvKeys } from 'src/env'

import {
  ComposeFile,
  DEV_HOST_SUFFIX,
  envFileSpecs,
  LILNAS_PROXY_NETWORK,
  loopbackPorts,
  networkNames,
  normalizeLabels,
  parseComposeFile,
  routesFromLabels,
} from './compose-file'
import {
  EnvFileRef,
  IdleReap,
  RegistryOptions,
  Route,
  Stack,
  StackService,
} from './registry.types'

export const REGISTRY_OPTIONS = Symbol('REGISTRY_OPTIONS')

const LILNAS_DEV_PROJECT = 'lilnas-dev'
const DEFAULT_LILNAS_REPO = '/home/jeremy/lilnas'
const DEFAULT_DEV_PROJECTS_ROOT = '/home/jeremy/dev'
const DEFAULT_MAX_IDLE_HOURS = 2
const CACHE_TTL_MS = 10_000

// Compose file names looked for in each ~/dev/<project>/ directory.
const DEV_COMPOSE_FILES = [
  'compose.yml',
  'compose.yaml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'docker-compose.dev.yml',
  'compose.dev.yml',
]

// Production names that a `<name>.lilnas.io` route would shadow, from
// docs/lilnas-expose.md.
const RESERVED_NAMES = new Set([
  'traefik',
  'auth',
  'portal',
  'equations',
  'me-token-tracker',
  'download',
  'yoink',
  'dashcam',
  'macros',
  'tdr-bot',
  'prometheus',
  'grafana',
])

const IDLE_REAP_ENABLED_LABEL = 'lilnas.idle-reap.enabled'
const IDLE_REAP_HOURS_LABEL = 'lilnas.idle-reap.max-idle-hours'

interface ParsedFile {
  compose: ComposeFile
  composeFile: string
  projectDir: string
}

// Discovers the stacks the dev dashboard manages by reading compose files.
// Files are parsed, never run through `docker compose config`, so variable
// interpolation (`${X:-y}`) stays verbatim.
@Injectable()
export class RegistryService {
  private readonly logger = new Logger(RegistryService.name)
  private readonly options: RegistryOptions
  private cache?: { expiresAt: number; stacks: Promise<Stack[]> }

  constructor(
    @Optional() @Inject(REGISTRY_OPTIONS) options?: Partial<RegistryOptions>,
  ) {
    const hours = Number(
      env(EnvKeys.DEFAULT_MAX_IDLE_HOURS, String(DEFAULT_MAX_IDLE_HOURS)),
    )
    this.options = {
      lilnasRepo: env(EnvKeys.LILNAS_REPO, DEFAULT_LILNAS_REPO),
      devProjectsRoot: env(
        EnvKeys.DEV_PROJECTS_ROOT,
        DEFAULT_DEV_PROJECTS_ROOT,
      ),
      defaultMaxIdleHours:
        Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MAX_IDLE_HOURS,
      cacheTtlMs: CACHE_TTL_MS,
      ...options,
    }
  }

  list(): Promise<Stack[]> {
    const now = Date.now()
    if (!this.cache || this.cache.expiresAt <= now) {
      this.cache = {
        expiresAt: now + this.options.cacheTtlMs,
        stacks: this.scan(),
      }
    }
    return this.cache.stacks
  }

  async get(id: string): Promise<Stack | undefined> {
    return (await this.list()).find(stack => stack.id === id)
  }

  async findByContainerName(
    name: string,
  ): Promise<{ stack: Stack; service: StackService } | undefined> {
    for (const stack of await this.list()) {
      const service = stack.services.find(s => s.containerName === name)
      if (service) return { stack, service }
    }
    return undefined
  }

  private async scan(): Promise<Stack[]> {
    const [lilnas, dev] = await Promise.all([this.scanLilnas(), this.scanDev()])
    return [...lilnas, ...dev]
  }

  private async scanLilnas(): Promise<Stack[]> {
    const appsDir = path.join(this.options.lilnasRepo, 'apps')
    const stacks: Stack[] = []

    for (const app of await this.listDirs(appsDir)) {
      const projectDir = path.join(appsDir, app)
      const parsed = await this.readCompose(
        path.join(projectDir, 'deploy.dev.yml'),
        projectDir,
      )
      if (!parsed) continue

      const routed = Object.values(parsed.compose.services).some(svc =>
        routesFromLabels(normalizeLabels(svc.labels)).some(route =>
          route.host.endsWith(DEV_HOST_SUFFIX),
        ),
      )
      if (!routed) continue

      stacks.push(
        await this.buildStack({
          ...parsed,
          id: `lilnas:${app}`,
          source: 'lilnas',
          name: app,
          projectName: LILNAS_DEV_PROJECT,
          composeArgs: ['-p', LILNAS_DEV_PROJECT, '-f', parsed.composeFile],
        }),
      )
    }
    return stacks
  }

  private async scanDev(): Promise<Stack[]> {
    const stacks: Stack[] = []

    for (const dir of await this.listDirs(this.options.devProjectsRoot)) {
      const projectDir = path.join(this.options.devProjectsRoot, dir)

      const present: string[] = []
      for (const file of DEV_COMPOSE_FILES) {
        if (await isFile(path.join(projectDir, file))) present.push(file)
      }

      for (const file of present) {
        const parsed = await this.readCompose(
          path.join(projectDir, file),
          projectDir,
        )
        if (!parsed) continue

        const onProxy = Object.values(parsed.compose.services).some(svc =>
          networkNames(svc.networks).includes(LILNAS_PROXY_NETWORK),
        )
        if (!onProxy) continue

        const isDevVariant = /\.dev\.ya?ml$/.test(file)
        stacks.push(
          await this.buildStack({
            ...parsed,
            id: `dev:${dir}:${file}`,
            source: 'dev',
            name: isDevVariant && present.length > 1 ? `${dir} (dev)` : dir,
            projectName: composeProjectName(parsed.compose.name, dir),
            composeArgs: ['-f', parsed.composeFile],
          }),
        )
      }
    }
    return stacks
  }

  private async buildStack(
    base: Pick<
      Stack,
      | 'id'
      | 'source'
      | 'name'
      | 'composeFile'
      | 'projectDir'
      | 'projectName'
      | 'composeArgs'
    > & { compose: ComposeFile },
  ): Promise<Stack> {
    const { compose, ...stack } = base
    const services: StackService[] = []
    const envSpecs = new Map<string, boolean>()

    for (const [name, svc] of Object.entries(compose.services)) {
      const labels = normalizeLabels(svc.labels)
      const routes = routesFromLabels(labels)

      services.push({
        name,
        containerName:
          typeof svc.container_name === 'string' && svc.container_name
            ? svc.container_name
            : `${stack.projectName}-${name}-1`,
        routes,
        idleReap: this.idleReap(labels, routes),
        loopbackPorts: loopbackPorts(svc.ports),
      })

      for (const spec of envFileSpecs(svc.env_file, stack.projectDir)) {
        envSpecs.set(
          spec.path,
          (envSpecs.get(spec.path) ?? false) || spec.required,
        )
      }
    }

    const envFiles: EnvFileRef[] = await Promise.all(
      [...envSpecs].map(async ([envPath, required]) => ({
        path: envPath,
        required,
        exists: await isFile(envPath),
      })),
    )

    return { ...stack, services, envFiles, warnings: shadowWarnings(services) }
  }

  private idleReap(labels: Map<string, string>, routes: Route[]): IdleReap {
    const hours = Number(labels.get(IDLE_REAP_HOURS_LABEL))
    const maxIdleHours =
      labels.has(IDLE_REAP_HOURS_LABEL) && Number.isFinite(hours) && hours > 0
        ? hours
        : this.options.defaultMaxIdleHours

    const enabled = labels.get(IDLE_REAP_ENABLED_LABEL)?.toLowerCase()
    if (enabled === 'false') {
      return { enabled: false, maxIdleHours, reason: 'label' }
    }
    if (enabled === 'true') {
      return { enabled: true, maxIdleHours, reason: 'label' }
    }
    if (routes.some(route => route.host.endsWith(DEV_HOST_SUFFIX))) {
      return { enabled: true, maxIdleHours, reason: 'auto' }
    }
    return { enabled: false, maxIdleHours, reason: 'none' }
  }

  /** Reads and parses one compose file; skips it (with a warning) on any failure. */
  private async readCompose(
    composeFile: string,
    projectDir: string,
  ): Promise<ParsedFile | undefined> {
    let text: string
    try {
      text = await fs.readFile(composeFile, 'utf8')
    } catch (err) {
      // A missing file is the normal case for most directories.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Cannot read ${composeFile}: ${errorMessage(err)}`)
      }
      return undefined
    }

    try {
      const compose = parseComposeFile(text)
      return compose && { compose, composeFile, projectDir }
    } catch (err) {
      this.logger.warn(`Skipping ${composeFile}: ${errorMessage(err)}`)
      return undefined
    }
  }

  private async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
    } catch (err) {
      this.logger.warn(`Cannot list ${dir}: ${errorMessage(err)}`)
      return []
    }
  }
}

/** Compose's project name: `name:` if set, else the lowercased, sanitized dir name. */
function composeProjectName(name: unknown, dir: string): string {
  if (typeof name === 'string' && name) return name
  return dir.toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

function shadowWarnings(services: StackService[]): string[] {
  const hosts = new Set(
    services.flatMap(svc => svc.routes.map(route => route.host)),
  )
  return [...hosts]
    .filter(host => {
      const [, name] = /^([^.]+)\.lilnas\.io$/.exec(host) ?? []
      return name !== undefined && RESERVED_NAMES.has(name)
    })
    .map(host => `route ${host} shadows a production name`)
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile()
  } catch {
    return false
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
