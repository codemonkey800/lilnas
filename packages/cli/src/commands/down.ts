import BaseComposeCommand from 'src/core/base-compose.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class Down extends BaseComposeCommand {
  static override description =
    'Bring down Docker Compose services with docker-compose down --rmi all -v'

  override composeArgs = ['down', '--rmi', 'all', '-v']
  override mode: ServiceMode = 'prod'
}
