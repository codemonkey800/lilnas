import { spawn } from 'node:child_process'

import type { DockerComposeOptions } from 'src/types.js'

/**
 * Check if docker-compose is installed and available
 * Throws an error if not found
 */
export async function checkDockerCompose(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker-compose', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    proc.on('error', () => {
      reject(
        new Error(
          'docker-compose is not installed or not available in PATH. Please install Docker Compose to use this command.',
        ),
      )
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            'docker-compose is not installed or not available in PATH. Please install Docker Compose to use this command.',
          ),
        )
      }
    })
  })
}

/**
 * Execute docker-compose with given arguments
 * Output is passed through to the terminal via stdio: 'inherit'
 */
export async function execDockerCompose(
  composeFile: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fullArgs = ['-f', composeFile, ...args]

    const proc = spawn('docker-compose', fullArgs, {
      stdio: 'inherit',
    })

    proc.on('error', err => {
      reject(new Error(`Failed to execute docker-compose: ${err.message}`))
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`docker-compose exited with code ${code}`))
      }
    })
  })
}

/**
 * Run docker-compose up
 * Equivalent to: docker-compose -f <file> up [-d] [services...]
 */
export async function composeUp(options: DockerComposeOptions): Promise<void> {
  const args: string[] = ['up']

  if (options.detach) {
    args.push('-d')
  }

  if (options.services && options.services.length > 0) {
    args.push(...options.services)
  }

  await execDockerCompose(options.composeFile, args)
}

/**
 * Run docker-compose down
 * Equivalent to: docker-compose -f <file> down --rmi all -v [services...]
 */
export async function composeDown(
  options: DockerComposeOptions,
): Promise<void> {
  const args: string[] = ['down', '--rmi', 'all', '-v']

  if (options.services && options.services.length > 0) {
    args.push(...options.services)
  }

  await execDockerCompose(options.composeFile, args)
}

/**
 * Run docker-compose build
 * Equivalent to: docker-compose -f <file> build [services...]
 */
export async function composeBuild(
  options: DockerComposeOptions,
): Promise<void> {
  const args: string[] = ['build']

  if (options.services && options.services.length > 0) {
    args.push(...options.services)
  }

  await execDockerCompose(options.composeFile, args)
}
