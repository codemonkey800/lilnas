export type StackSource = 'lilnas' | 'dev'

export interface Route {
  router: string
  host: string
  url: string
  pathPrefix?: string
  gated: boolean
  port?: number
}

/** `path` is absolute. */
export interface EnvFileRef {
  path: string
  required: boolean
  exists: boolean
}

export interface IdleReap {
  enabled: boolean
  maxIdleHours: number
  reason: 'label' | 'auto' | 'none'
}

export interface StackService {
  name: string
  /** `container_name`, or `${project}-${name}-1`. */
  containerName: string
  routes: Route[]
  idleReap: IdleReap
  /** Loopback-bound published ports as written, e.g. '127.0.0.1:8090:8080'. */
  loopbackPorts: string[]
}

export interface Stack {
  /** 'lilnas:download' | 'dev:hop-road:docker-compose.dev.yml' */
  id: string
  source: StackSource
  name: string
  composeFile: string
  projectDir: string
  projectName: string
  /** Arguments to put after `docker compose` to target this stack. */
  composeArgs: string[]
  services: StackService[]
  envFiles: EnvFileRef[]
  warnings: string[]
}

export interface RegistryOptions {
  lilnasRepo: string
  devProjectsRoot: string
  defaultMaxIdleHours: number
  cacheTtlMs: number
}
