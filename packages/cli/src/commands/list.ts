import { Command, Flags } from '@oclif/core'

import {
  findProjectRoot,
  listAllServices,
  listInfraServices,
  listPackageServices,
} from 'src/utils/service-discovery.js'

export default class List extends Command {
  static override description = 'List all services in the monorepo'

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --apps',
    '<%= config.bin %> <%= command.id %> --services',
  ]

  static override flags = {
    apps: Flags.boolean({
      description: 'List only package services (from packages/*)',
      exclusive: ['services'],
    }),
    services: Flags.boolean({
      description: 'List only infrastructure services (from infra/*)',
      exclusive: ['apps'],
    }),
  }

  // Dev mode commands will override this
  protected devMode = false

  async run(): Promise<void> {
    const { flags } = await this.parse(List)
    const rootDir = findProjectRoot()

    let services
    if (flags.apps) {
      services = await listPackageServices(this.devMode, rootDir)
    } else if (flags.services) {
      services = await listInfraServices(this.devMode, rootDir)
    } else {
      services = await listAllServices(this.devMode, rootDir)
    }

    // Output service names, one per line
    for (const service of services) {
      this.log(service.name)
    }
  }
}
