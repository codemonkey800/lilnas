import List from 'src/commands/list.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class DevList extends List {
  static override aliases = ['dev:ls']

  static override description =
    'List discovered dev services from deploy.dev.yml and infra compose files'

  override mode: ServiceMode = 'dev'
}
