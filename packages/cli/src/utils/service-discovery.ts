import { spawn } from 'node:child_process'
import { accessSync } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { COMPOSE_FILES, DEPLOY_FILES, DIRECTORIES } from 'src/constants.js'
import type { ServiceInfo } from 'src/types.js'

/**
 * Find the monorepo root directory by looking for pnpm-workspace.yaml
 * Walks up from the current directory until found or throws an error
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = startDir

  // Walk up the directory tree looking for pnpm-workspace.yaml
  while (true) {
    const workspaceFile = join(currentDir, 'pnpm-workspace.yaml')

    // Check synchronously since this is a simple existence check
    try {
      accessSync(workspaceFile)
      return currentDir
    } catch {
      // File not found, go up a directory
      const parentDir = dirname(currentDir)

      // If we've reached the root, stop
      if (parentDir === currentDir) {
        throw new Error(
          'Could not find monorepo root (no pnpm-workspace.yaml found)',
        )
      }

      currentDir = parentDir
    }
  }
}

/**
 * Get the path to the main docker-compose file based on dev mode
 */
export function getComposeFile(devMode: boolean, rootDir: string): string {
  const fileName = devMode
    ? COMPOSE_FILES.development
    : COMPOSE_FILES.production
  return join(rootDir, fileName)
}

/**
 * Get the path to a package's deploy file based on dev mode
 */
export function getDeployFile(devMode: boolean, packageDir: string): string {
  const fileName = devMode ? DEPLOY_FILES.development : DEPLOY_FILES.production
  return join(packageDir, fileName)
}

/**
 * Execute docker-compose config --services and return the list of service names
 */
export async function getServicesFromFile(
  composeFile: string,
): Promise<string[]> {
  // First check if file exists
  try {
    await access(composeFile)
  } catch {
    throw new Error(`Compose file not found: ${composeFile}`)
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'docker-compose',
      ['-f', composeFile, 'config', '--services'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('error', err => {
      reject(new Error(`Failed to execute docker-compose: ${err.message}`))
    })

    proc.on('close', code => {
      if (code !== 0) {
        // Return empty array on error (file might be invalid or have no services)
        resolve([])
        return
      }

      // Parse stdout - each line is a service name
      const services = stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0)

      resolve(services)
    })
  })
}

/**
 * List services from package deploy files
 * Scans packages/* directories for deploy.yml (or deploy.dev.yml in devMode)
 */
export async function listPackageServices(
  devMode: boolean,
  rootDir: string,
): Promise<ServiceInfo[]> {
  const packagesDir = join(rootDir, DIRECTORIES.packages)
  const services: ServiceInfo[] = []

  // Check if packages directory exists
  try {
    await access(packagesDir)
  } catch {
    throw new Error(`Packages directory not found: ${packagesDir}`)
  }

  // List all directories in packages/
  const entries = await readdir(packagesDir)

  for (const entry of entries) {
    const packageDir = join(packagesDir, entry)

    // Check if it's a directory
    const entryStat = await stat(packageDir)
    if (!entryStat.isDirectory()) {
      continue
    }

    // Check for deploy file
    const deployFile = getDeployFile(devMode, packageDir)
    try {
      await access(deployFile)
    } catch {
      // No deploy file, skip this package
      continue
    }

    // Get services from this deploy file
    const serviceNames = await getServicesFromFile(deployFile)

    for (const name of serviceNames) {
      services.push({
        name,
        source: 'package',
        composeFile: deployFile,
      })
    }
  }

  return services
}

/**
 * Parse the include section from a docker-compose file to find infra files
 */
async function parseIncludedInfraFiles(
  composeFile: string,
  rootDir: string,
): Promise<string[]> {
  // Read the compose file content
  let content: string
  try {
    content = await readFile(composeFile, 'utf-8')
  } catch {
    throw new Error(`Could not read compose file: ${composeFile}`)
  }

  // Parse the include section to find ./infra/*.yml files
  // Match lines like:   - ./infra/proxy.yml
  const infraPattern = /^\s*-\s*\.\/infra\/[\w.-]+\.yml/gm
  const matches = content.match(infraPattern) || []

  // Extract file paths and convert to absolute paths
  return matches
    .map(match => {
      // Remove leading whitespace, dash, and whitespace
      const relativePath = match.replace(/^\s*-\s*/, '').replace(/^\.\//, '')
      return join(rootDir, relativePath)
    })
    .filter(Boolean)
}

/**
 * List services from infrastructure files
 * Reads docker-compose.yml (or dev version) and parses the include section
 */
export async function listInfraServices(
  devMode: boolean,
  rootDir: string,
): Promise<ServiceInfo[]> {
  const composeFile = getComposeFile(devMode, rootDir)
  const infraDir = join(rootDir, DIRECTORIES.infra)
  const services: ServiceInfo[] = []

  // Check if infra directory exists
  try {
    await access(infraDir)
  } catch {
    throw new Error(`Infra directory not found: ${infraDir}`)
  }

  // Check if compose file exists
  try {
    await access(composeFile)
  } catch {
    throw new Error(`Compose file not found: ${composeFile}`)
  }

  // Get the list of included infra files from the compose file
  const infraFiles = await parseIncludedInfraFiles(composeFile, rootDir)

  // Get services from each infra file
  for (const infraFile of infraFiles) {
    try {
      await access(infraFile)
    } catch {
      // File doesn't exist, skip
      continue
    }

    const serviceNames = await getServicesFromFile(infraFile)

    for (const name of serviceNames) {
      services.push({
        name,
        source: 'infra',
        composeFile: infraFile,
      })
    }
  }

  return services
}

/**
 * List all services from both packages and infrastructure
 */
export async function listAllServices(
  devMode: boolean,
  rootDir: string,
): Promise<ServiceInfo[]> {
  const [packageServices, infraServices] = await Promise.all([
    listPackageServices(devMode, rootDir),
    listInfraServices(devMode, rootDir),
  ])

  return [...packageServices, ...infraServices]
}
