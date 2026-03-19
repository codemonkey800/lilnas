import { spawnSync } from 'child_process'

const POSTGRES_IMAGE = 'postgres:17-alpine'

export interface PostgresOptions {
  containerName: string
  port: number
  user: string
  password: string
  db: string
  dbPath?: string
}

/**
 * Builds a PostgreSQL connection URL, percent-encoding the password so that
 * special characters do not break the URI (replaces the python3 approach in dev.sh).
 */
export function buildDatabaseUrl(
  user: string,
  password: string,
  host: string,
  port: number,
  db: string,
): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`
}

/**
 * Starts a Postgres container for local development.
 * Removes any pre-existing container with the same name first.
 * Optionally mounts a host directory for persistent storage.
 */
export function startPostgres(opts: PostgresOptions): void {
  const { containerName, port, user, password, db, dbPath } = opts

  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' })

  const args: string[] = [
    'run',
    '-d',
    '--name',
    containerName,
    '-e',
    `POSTGRES_USER=${user}`,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    `POSTGRES_DB=${db}`,
    '-p',
    `${port}:5432`,
  ]

  if (dbPath) {
    args.push('-v', `${dbPath}:/var/lib/postgresql/data`)
  }

  args.push(POSTGRES_IMAGE)

  const result = spawnSync('docker', args, { stdio: 'pipe' })

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? ''
    throw new Error(`Failed to start Postgres container: ${stderr}`)
  }
}

/**
 * Polls pg_isready inside the container until Postgres accepts connections
 * or the timeout expires. Throws if the timeout is reached.
 */
export function waitForPostgres(
  containerName: string,
  user: string,
  db: string,
  timeoutSec = 30,
): void {
  for (let i = 1; i <= timeoutSec; i++) {
    const result = spawnSync(
      'docker',
      ['exec', containerName, 'pg_isready', '-U', user, '-d', db],
      { stdio: 'pipe' },
    )

    if (result.status === 0) return

    if (i === timeoutSec) {
      throw new Error(
        `Postgres failed to become ready within ${timeoutSec} seconds`,
      )
    }

    spawnSync('sleep', ['1'])
  }
}

/**
 * Stops and removes a Postgres container. Failures are silently swallowed
 * so cleanup never throws (mirrors the `|| true` pattern in dev.sh).
 */
export function stopPostgres(containerName: string): void {
  spawnSync('docker', ['stop', containerName], { stdio: 'pipe' })
  spawnSync('docker', ['rm', containerName], { stdio: 'pipe' })
}
