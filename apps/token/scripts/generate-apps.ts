/**
 * Build-time script that scans the monorepo's `apps/` directory and generates
 * a JSON manifest of all applications. The manifest is written to
 * `src/generated/apps.json` and is consumed by the NestJS backend at runtime
 * to pre-populate the UI with all known apps.
 *
 * Run automatically as `prebuild` in package.json.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const appsDir = path.join(repoRoot, 'apps')
const outputDir = path.join(__dirname, '../src/generated')
const outputFile = path.join(outputDir, 'apps.json')

interface AppEntry {
  slug: string
  packageName: string
}

function generateApps(): void {
  const entries = fs.readdirSync(appsDir, { withFileTypes: true })

  const apps: AppEntry[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const slug = entry.name

    // Skip the token app itself
    if (slug === 'token') continue

    const pkgPath = path.join(appsDir, slug, 'package.json')
    if (!fs.existsSync(pkgPath)) continue

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      name?: string
    }

    if (!pkg.name) continue

    apps.push({
      slug,
      packageName: pkg.name,
    })
  }

  apps.sort((a, b) => a.slug.localeCompare(b.slug))

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(outputFile, JSON.stringify(apps, null, 2) + '\n')

  console.log(`Generated ${apps.length} app entries -> ${outputFile}`)
  apps.forEach(app => console.log(`  ${app.slug} (${app.packageName})`))
}

generateApps()
