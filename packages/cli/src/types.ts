/**
 * Source of a service - either from packages/ or infra/ directory
 */
export type ServiceSource = 'package' | 'infra'

/**
 * Filter type for listing services
 */
export type ServiceFilter = 'apps' | 'services' | 'all'

/**
 * Information about a discovered service
 */
export interface ServiceInfo {
  /** Service name (e.g., 'tdr-bot', 'proxy') */
  name: string
  /** Where the service is defined */
  source: ServiceSource
  /** Absolute path to the docker-compose file */
  composeFile: string
}

/**
 * Options for service discovery
 */
export interface ServiceDiscoveryOptions {
  /** Whether to look for dev compose files (deploy.dev.yml vs deploy.yml) */
  devMode: boolean
  /** Root directory of the monorepo */
  rootDir: string
}

/**
 * Options for docker-compose command execution
 */
export interface DockerComposeOptions {
  /** Path to the docker-compose file */
  composeFile: string
  /** Specific services to target (optional, defaults to all in file) */
  services?: string[]
  /** Run in detached mode (-d flag) */
  detach?: boolean
}
