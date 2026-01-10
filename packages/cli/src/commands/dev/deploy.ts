import Deploy from 'src/commands/deploy.js'

export default class DevDeploy extends Deploy {
  static override description =
    'Deploy services in development mode (bring down then up in detached mode)'

  protected override devMode = true
}
