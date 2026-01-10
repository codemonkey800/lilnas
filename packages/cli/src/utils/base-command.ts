import { Command, Flags } from '@oclif/core'

import {
  findProjectRoot,
  listInfraServices,
  listPackageServices,
} from './service-discovery.js'

/**
 * Shared flags for docker-compose commands
 * These can be spread into command flag definitions
 */
export const sharedFlags = {
  apps: Flags.boolean({
    char: 'a',
    description: 'Target all package services (from packages/*/deploy*.yml)',
    exclusive: ['services'],
  }),
  services: Flags.boolean({
    char: 's',
    description: 'Target all infrastructure services (from infra/*.yml)',
    exclusive: ['apps'],
  }),
}

/**
 * Interface for parsed flags from sharedFlags
 */
export interface SharedFlags {
  apps?: boolean
  services?: boolean
}

/**
 * Base command class providing shared functionality for docker-compose commands.
 * Subclasses should extend this and implement their specific run logic.
 */
export abstract class BaseCommand extends Command {
  /**
   * Whether to use development compose files (deploy.dev.yml vs deploy.yml)
   * Dev mode commands will override this to true
   */
  protected devMode: boolean = false

  /**
   * Get the list of target services based on flags and arguments
   *
   * @param flags - Parsed command flags (apps, services)
   * @param argv - Command arguments (specific service names)
   * @returns Array of service names to target
   * @throws Error if validation fails
   */
  protected async getTargetServices(
    flags: SharedFlags,
    argv: string[],
  ): Promise<string[]> {
    const hasSpecificServices = argv.length > 0
    const hasAppsFlag = flags.apps === true
    const hasServicesFlag = flags.services === true

    // Validate: can't mix flags with specific services
    if (hasSpecificServices && (hasAppsFlag || hasServicesFlag)) {
      this.error(
        'Cannot specify both --apps/--services flags and specific service names',
      )
    }

    // Validate: can't use both --apps and --services
    // Note: This is also enforced by oclif's exclusive option, but we double-check
    if (hasAppsFlag && hasServicesFlag) {
      this.error('Cannot specify both --apps and --services flags')
    }

    const rootDir = findProjectRoot()

    // Return services based on flags or arguments
    if (hasAppsFlag) {
      const packageServices = await listPackageServices(this.devMode, rootDir)
      return packageServices.map(service => service.name)
    }

    if (hasServicesFlag) {
      const infraServices = await listInfraServices(this.devMode, rootDir)
      return infraServices.map(service => service.name)
    }

    // Return specific service names from arguments
    return argv
  }
}
