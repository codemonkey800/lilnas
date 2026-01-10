/**
 * Docker compose file names for different environments
 */
export const COMPOSE_FILES = {
  production: 'docker-compose.yml',
  development: 'docker-compose.dev.yml',
} as const

/**
 * Deploy file names for package-specific deployments
 */
export const DEPLOY_FILES = {
  production: 'deploy.yml',
  development: 'deploy.dev.yml',
} as const

/**
 * Directory names in the monorepo
 */
export const DIRECTORIES = {
  packages: 'packages',
  infra: 'infra',
} as const
