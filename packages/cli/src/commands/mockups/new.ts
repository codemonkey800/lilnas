import { Args, Command, Flags } from '@oclif/core'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import * as path from 'path'

import { buildMockups } from '../../utils/mockup-builder'
import { mockupTemplate } from '../../utils/mockup-template'
import { mockupProjectDir } from '../../utils/mockups'
import { getMonorepoRoot } from '../../utils/paths'

/** Kebab-case, and safe to drop straight into a path. */
const FEATURE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

export class MockupsNew extends Command {
  static override description =
    'Scaffold a new mockup project under docs/features/<feature>/designs'

  static override examples = [
    '<%= config.bin %> mockups new billing',
    '<%= config.bin %> mockups new billing --no-build',
  ]

  static override args = {
    feature: Args.string({
      description: 'Feature name, e.g. `billing` for docs/features/billing',
      required: true,
    }),
  }

  static override flags = {
    build: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Run the first build so the pages open immediately',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MockupsNew)
    const feature = args.feature

    if (!FEATURE_NAME.test(feature)) {
      this.error(
        `"${feature}" isn't a usable feature name — use kebab-case, e.g. "billing"`,
        { exit: 1 },
      )
    }

    const root = getMonorepoRoot()
    const dir = mockupProjectDir(root, feature)
    if (existsSync(dir)) {
      this.error(`${path.relative(root, dir)} already exists`, { exit: 1 })
    }

    for (const file of mockupTemplate(feature)) {
      const target = path.join(dir, file.path)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.contents)
      this.log(`  ${path.relative(root, target)}`)
    }

    if (flags.build) {
      const result = await buildMockups(dir, {
        warn: message => this.warn(message),
      })
      this.log(`\nbuilt ${result.pages} page${result.pages === 1 ? '' : 's'}`)
    }

    // No config to edit: the root turbo task, the prettier check and the
    // .gitignore all match docs/features/*/designs, so a new directory is
    // picked up by every one of them without being registered anywhere.
    this.log(
      `\n${feature} is ready — open ${path.relative(root, path.join(dir, 'index.html'))}\n` +
        'Edit src/pages/index.pug, then `pnpm mockups` (or `pnpm mockups:watch`).',
    )
  }
}
