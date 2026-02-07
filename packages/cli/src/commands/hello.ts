import { Command } from '@oclif/core'

export default class Hello extends Command {
  static override description = 'Say hello (placeholder command)'

  async run(): Promise<void> {
    await this.parse(Hello)
    this.log('Hello from @lilnas/cli!')
  }
}
