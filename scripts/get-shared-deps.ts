#!/usr/bin/env tsx

import { $ } from 'zx'

async function getPackageFiles() {
  const outupt = await $`fd package.json packages/`
  return outupt.stdout.split('\n').filter(Boolean)
}

async function main() {
  const packageFiles = await getPackageFiles()
  const depsCount = new Map<string, number>()

  for (const file of packageFiles) {
    const devDepsOutput = await $`jq -r .devDependencies ${file}`
    const devDeps: Record<string, string> = JSON.parse(devDepsOutput.stdout)

    if (devDeps) {
      for (const key of Object.keys(devDeps)) {
        depsCount.set(key, (depsCount.get(key) || 0) + 1)
      }
    }
  }

  for (const [key, value] of depsCount) {
    if (value > 1) {
      console.log(`${key} => ${value}`)
    }
  }
}

main()
