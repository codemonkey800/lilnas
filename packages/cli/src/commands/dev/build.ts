import Build from 'src/commands/build.js'

export default class DevBuild extends Build {
  static override description =
    'Build Docker images for services in development mode'

  protected override devMode = true
}
