import { Command } from '@oclif/core'
import { spawn, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

import { loadEnvFile } from '../utils/env'
import { getMonorepoRoot } from '../utils/paths'
import {
  buildDatabaseUrl,
  startPostgres,
  stopPostgres,
  waitForPostgres,
} from '../utils/postgres'

export class Dev extends Command {
  static override description =
    'Start the development server for the current app. Must be run from within an apps/<name>/ directory.'

  static override examples = [
    'cd apps/tdr-bot && <%= config.bin %> dev',
    'cd apps/yoink && pnpm dev',
  ]

  async run(): Promise<void> {
    const cwd = process.cwd()
    const root = getMonorepoRoot()
    const appsDir = path.join(root, 'apps')

    if (!cwd.startsWith(appsDir + path.sep)) {
      this.error(
        `Must be run from within an apps/<name>/ directory (cwd: ${cwd})`,
        { exit: 1 },
      )
    }

    const relative = path.relative(appsDir, cwd)
    const appName = relative.split(path.sep)[0]

    if (!appName) {
      this.error('Could not detect app name from current directory', {
        exit: 1,
      })
    }

    const appDir = path.join(appsDir, appName)

    // Load env in layers: infra env first, then local .env.dev overrides
    loadEnvFile(path.join(root, 'infra', `.env.${appName}`))
    loadEnvFile(path.join(appDir, '.env.dev'))

    // Auto-detect Drizzle by presence of drizzle.config.ts in the app root,
    // then read the dialect to decide whether a database container is needed.
    // SQLite apps don't need Postgres (or Docker) — the schema is a file on
    // disk and migrations are applied by the app itself at boot.
    const drizzleConfigPath = path.join(appDir, 'drizzle.config.ts')
    const drizzleDialect = readDrizzleDialect(drizzleConfigPath)
    const needsPostgres = drizzleDialect === 'postgresql'

    let containerName: string | null = null
    let cleaned = false

    if (drizzleDialect === 'sqlite') {
      this.log(
        'Detected SQLite Drizzle config — skipping Postgres container (DB is a file on disk).',
      )
    }

    if (needsPostgres) {
      const user = process.env.POSTGRES_USER ?? 'postgres'
      const password = process.env.POSTGRES_PASSWORD ?? 'postgres'
      const db = process.env.POSTGRES_DB ?? appName
      const port = parseInt(process.env.POSTGRES_PORT ?? '5432', 10)
      const dbPath = process.env.DB_PATH

      containerName = `${appName}-dev-db`

      this.log(`Starting ${containerName} on port ${port}...`)

      if (dbPath) {
        this.log(`Mounting persistent DB storage at ${dbPath}`)
      } else {
        this.log(
          'No DB_PATH set — database will be ephemeral (set DB_PATH in .env.dev to persist data).',
        )
      }

      try {
        startPostgres({ containerName, port, user, password, db, dbPath })
      } catch (err) {
        this.error(err instanceof Error ? err.message : String(err), {
          exit: 1,
        })
      }

      this.log('Waiting for Postgres to be ready...')

      try {
        waitForPostgres(containerName, user, db)
      } catch (err) {
        stopPostgres(containerName)
        this.error(err instanceof Error ? err.message : String(err), {
          exit: 1,
        })
      }

      this.log('Postgres is ready.')

      process.env.DATABASE_URL = buildDatabaseUrl(
        user,
        password,
        'localhost',
        port,
        db,
      )
      process.env.POSTGRES_HOST = 'localhost'
      process.env.POSTGRES_PORT = String(port)

      const force = !dbPath

      this.log(
        force
          ? 'Pushing schema to ephemeral dev database...'
          : 'Pushing schema to persistent dev database (interactive)...',
      )

      const pushResult = spawnSync(
        'pnpm',
        ['exec', 'drizzle-kit', 'push', ...(force ? ['--force'] : [])],
        { stdio: 'inherit', cwd: appDir, env: process.env },
      )

      if (pushResult.status !== 0) {
        stopPostgres(containerName)
        this.error('drizzle-kit push failed', { exit: 1 })
      }
    }

    const cleanup = () => {
      if (cleaned || !containerName) return
      cleaned = true
      process.stderr.write(`\nStopping and removing ${containerName}...\n`)
      stopPostgres(containerName)
    }

    process.on('exit', cleanup)

    this.log('\nStarting dev server...')

    const child = spawn('pnpm', ['run', 'dev:start'], {
      stdio: 'inherit',
      cwd: appDir,
      env: process.env,
    })

    // Prevent the parent from exiting on SIGINT — the terminal delivers it to
    // the entire process group, so the child receives it and will exit on its
    // own, triggering our cleanup via the exit handler below.
    process.on('SIGINT', () => {})

    process.on('SIGTERM', () => {
      child.kill('SIGTERM')
    })

    await new Promise<void>(resolve => {
      child.on('exit', code => {
        cleanup()
        resolve()
        process.exit(code ?? 0)
      })
    })
  }
}

// Returns the Drizzle dialect declared in `drizzle.config.ts`, or null if the
// config doesn't exist. Reads the file as text and matches the `dialect: '...'`
// literal rather than importing the module — importing would execute the
// config's side effects (env reads, etc.) just to discover one string.
function readDrizzleDialect(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return null
  const source = fs.readFileSync(configPath, 'utf8')
  const match = source.match(/dialect:\s*['"]([^'"]+)['"]/)
  return match?.[1] ?? null
}
