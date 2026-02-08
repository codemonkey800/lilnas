import BaseCommand from 'src/core/base-command.js'

export default class Hello extends BaseCommand {
  static override description = 'Say hello (placeholder command)'

  async run(): Promise<void> {
    await this.parse(Hello)
    this.log('Hello from @lilnas/cli!')
  }
}
