import { Command, Flags } from '@oclif/core'

import { getMonorepoRoot } from '../utils/paths'
import { listAppServices, listInfraServices } from '../utils/services'

export class List extends Command {
  static override description = 'List all services in the monorepo'

  static override examples = [
    '<%= config.bin %> list',
    '<%= config.bin %> list --apps',
    '<%= config.bin %> list --services',
  ]

  static override flags = {
    apps: Flags.boolean({
      description: 'List only app services (from apps/*/deploy.yml)',
      exclusive: ['services'],
    }),
    services: Flags.boolean({
      description: 'List only infrastructure services (from infra/*.yml)',
      exclusive: ['apps'],
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(List)
    const root = getMonorepoRoot()

    const showApps = flags.apps === true
    const showInfra = flags.services === true
    const showAll = !showApps && !showInfra

    if (showApps || showAll) {
      const appServices = listAppServices(root)
      for (const svc of appServices) {
        this.log(svc)
      }
    }

    if (showInfra || showAll) {
      const infraServices = listInfraServices(root)
      for (const svc of infraServices) {
        this.log(svc)
      }
    }
  }
}
