import BaseComposeCommand from 'src/core/base-compose.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class DevBuild extends BaseComposeCommand {
  static override description =
    'Build Docker images for dev services with docker-compose build'

  override composeArgs = ['build']
  override mode: ServiceMode = 'dev'
}
