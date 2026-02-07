import BaseRunCommand from 'src/core/base-run.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class DevRun extends BaseRunCommand {
  static override description =
    'Run a one-off dev service container and remove it after exit'

  override mode: ServiceMode = 'dev'
}
