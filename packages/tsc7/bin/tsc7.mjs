#!/usr/bin/env node
// `typescript@7` has no `exports` entry for its CLI and its `tsc` bin would
// collide with TypeScript 6's, so load the CLI entrypoint by file path.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('typescript-7/package.json'))

await import(pathToFileURL(join(root, 'lib', 'tsc.js')).href)
