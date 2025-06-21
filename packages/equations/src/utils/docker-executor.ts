import { Logger } from '@nestjs/common'
import { spawn } from 'child_process'
import * as fs from 'fs-extra'
import path from 'path'

interface DockerExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export class DockerLatexExecutor {
  private readonly logger = new Logger(DockerLatexExecutor.name)
  private static readonly LATEX_IMAGE = 'lilnas/latex-sandbox:latest'
  private static readonly IMAGEMAGICK_IMAGE = 'lilnas/latex-sandbox:latest'

  /**
   * Check if Docker is available and LaTeX sandbox image exists
   */
  async checkDockerAvailability(): Promise<boolean> {
    try {
      // Check if Docker is running
      const dockerResult = await this.runCommand('docker', ['version'], {
        timeout: 5000,
      })
      if (dockerResult.exitCode !== 0) {
        this.logger.warn('Docker is not available')
        return false
      }

      // Check if our LaTeX sandbox image exists
      const imageResult = await this.runCommand(
        'docker',
        ['images', '-q', DockerLatexExecutor.LATEX_IMAGE],
        { timeout: 5000 },
      )
      if (!imageResult.stdout.trim()) {
        this.logger.warn(
          `LaTeX sandbox image ${DockerLatexExecutor.LATEX_IMAGE} not found. Please build it first.`,
        )
        return false
      }

      return true
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        'Docker availability check failed',
      )
      return false
    }
  }

  /**
   * Compile LaTeX using Docker sandbox for maximum security
   */
  async compileLatexInDocker(
    texFile: string,
    workingDir: string,
  ): Promise<DockerExecResult> {
    const filename = path.basename(texFile)

    const dockerArgs = [
      'run',
      '--rm', // Remove container after execution
      '--network=none', // No network access
      '--memory=256m', // Memory limit
      '--cpus=0.5', // CPU limit
      '--user=1001:1001', // Non-root user
      '--read-only', // Read-only filesystem
      '--tmpfs=/tmp:noexec,nosuid,size=50m', // Temporary filesystem
      '-v',
      `${workingDir}:/workspace:rw`, // Mount working directory
      '--security-opt=no-new-privileges', // Prevent privilege escalation
      '--cap-drop=ALL', // Drop all capabilities
      DockerLatexExecutor.LATEX_IMAGE,
      '-no-shell-escape',
      '-halt-on-error',
      '-interaction=nonstopmode',
      '-file-line-error',
      '-output-directory=.',
      filename,
    ]

    this.logger.log(
      {
        image: DockerLatexExecutor.LATEX_IMAGE,
        file: filename,
        workingDir,
      },
      'Compiling LaTeX in Docker sandbox',
    )

    return this.runCommand('docker', dockerArgs, {
      cwd: workingDir,
      timeout: 20000, // 20 seconds timeout
    })
  }

  /**
   * Process image using Docker sandbox
   */
  async processImageInDocker(
    inputFile: string,
    outputFile: string,
    workingDir: string,
  ): Promise<DockerExecResult> {
    const inputBasename = path.basename(inputFile)
    const outputBasename = path.basename(outputFile)

    const dockerArgs = [
      'run',
      '--rm',
      '--network=none',
      '--memory=128m',
      '--cpus=0.25',
      '--user=1001:1001',
      '--read-only',
      '--tmpfs=/tmp:noexec,nosuid,size=25m',
      '-v',
      `${workingDir}:/workspace:rw`,
      '--security-opt=no-new-privileges',
      '--cap-drop=ALL',
      '--entrypoint=convert', // Use ImageMagick convert
      DockerLatexExecutor.IMAGEMAGICK_IMAGE,
      inputBasename,
      '-background',
      'white',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      '-resize',
      '2000x2000>', // Limit size
      '-quality',
      '85',
      outputBasename,
    ]

    this.logger.log(
      {
        inputFile: inputBasename,
        outputFile: outputBasename,
        workingDir,
      },
      'Processing image in Docker sandbox',
    )

    return this.runCommand('docker', dockerArgs, {
      cwd: workingDir,
      timeout: 15000, // 15 seconds timeout
    })
  }

  /**
   * Build the LaTeX sandbox Docker image
   */
  async buildSandboxImage(): Promise<boolean> {
    const dockerfilePath = path.join(
      __dirname,
      '../../latex-sandbox.dockerfile',
    )
    const contextPath = path.join(__dirname, '../..')

    // Check if Dockerfile exists
    if (!(await fs.pathExists(dockerfilePath))) {
      this.logger.error(
        { dockerfilePath },
        'LaTeX sandbox Dockerfile not found',
      )
      return false
    }

    const buildArgs = [
      'build',
      '-f',
      dockerfilePath,
      '-t',
      DockerLatexExecutor.LATEX_IMAGE,
      contextPath,
    ]

    this.logger.log('Building LaTeX sandbox Docker image...')

    try {
      const result = await this.runCommand('docker', buildArgs, {
        timeout: 300000, // 5 minutes timeout for build
      })

      if (result.exitCode === 0) {
        this.logger.log('LaTeX sandbox image built successfully')
        return true
      } else {
        this.logger.error(
          { stderr: result.stderr },
          'Failed to build LaTeX sandbox image',
        )
        return false
      }
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message },
        'Docker build failed',
      )
      return false
    }
  }

  /**
   * Generic command runner with security and resource limits
   */
  private async runCommand(
    command: string,
    args: string[],
    options: {
      cwd?: string
      timeout?: number
      env?: Record<string, string>
    } = {},
  ): Promise<DockerExecResult> {
    const { cwd, timeout = 30000, env = {} } = options

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        timeout,
        env: {
          ...process.env,
          ...env,
          PATH: '/usr/local/bin:/usr/bin:/bin', // Restricted PATH
        },
        detached: false,
      })

      let stdout = ''
      let stderr = ''
      let isTimedOut = false

      const timeoutHandle = setTimeout(() => {
        isTimedOut = true
        child.kill('SIGKILL')
        reject(new Error(`Command timed out after ${timeout}ms`))
      }, timeout)

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
        // Prevent memory exhaustion
        if (stdout.length > 1024 * 1024) {
          // 1MB limit
          child.kill('SIGKILL')
          reject(new Error('Output buffer exceeded maximum size'))
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        if (stderr.length > 1024 * 1024) {
          // 1MB limit
          child.kill('SIGKILL')
          reject(new Error('Error buffer exceeded maximum size'))
        }
      })

      child.on('error', error => {
        clearTimeout(timeoutHandle)
        if (!isTimedOut) {
          reject(error)
        }
      })

      child.on('close', code => {
        clearTimeout(timeoutHandle)
        if (!isTimedOut) {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? -1,
          })
        }
      })
    })
  }
}
