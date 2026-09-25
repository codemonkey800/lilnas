import { Command, Flags } from '@oclif/core'

import {
  buildMockups,
  MockupBuildResult,
  watchMockups,
} from '../../utils/mockup-builder'
import { MockupProject, resolveMockupProjects } from '../../utils/mockups'

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)}kb`

export class MockupsBuild extends Command {
  static override description =
    'Build UI mockups: Pug + Tailwind sources under docs/features/*/designs into self-contained HTML'

  static override examples = [
    '<%= config.bin %> mockups build',
    '<%= config.bin %> mockups build download',
    '<%= config.bin %> mockups build --watch',
    '<%= config.bin %> mockups build --all',
  ]

  static override strict = false

  static override flags = {
    all: Flags.boolean({
      char: 'a',
      description:
        'Build every project, ignoring which one the current directory sits in',
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Rebuild whenever a source file changes',
    }),
  }

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(MockupsBuild)
    const names = (argv as string[]).filter(arg => !arg.startsWith('-'))

    let projects: MockupProject[]
    try {
      projects = resolveMockupProjects(names, { all: flags.all })
    } catch (err) {
      return this.error(err instanceof Error ? err.message : String(err), {
        exit: 1,
      })
    }

    for (const project of projects) {
      await this.buildOnce(project, projects.length > 1)
    }

    if (!flags.watch) {
      return
    }

    this.log(
      `watching ${projects.map(p => `${p.name}/src`).join(', ')} — ctrl-c to stop`,
    )
    await Promise.race(
      projects.map(project =>
        watchMockups(project.dir, {
          onBuild: result => this.report(project, result, projects.length > 1),
          onError: error => this.logToStderr(`build failed: ${error.message}`),
          warn: message => this.warn(message),
        }),
      ),
    )
  }

  private async buildOnce(
    project: MockupProject,
    prefix: boolean,
  ): Promise<void> {
    try {
      this.report(
        project,
        await buildMockups(project.dir, {
          warn: message => this.warn(message),
        }),
        prefix,
      )
    } catch (err) {
      this.error(
        `${project.name}: ${err instanceof Error ? err.message : String(err)}`,
        { exit: 1 },
      )
    }
  }

  private report(
    project: MockupProject,
    result: MockupBuildResult,
    prefix: boolean,
  ): void {
    const pages = `${result.pages} page${result.pages === 1 ? '' : 's'}`
    this.log(
      `${prefix ? `${project.name}: ` : ''}built ${pages} in ` +
        `${result.durationMs}ms (${kb(result.cssBytes)} shared css, ` +
        `${kb(result.averagePageBytes)} avg page)`,
    )
  }
}
