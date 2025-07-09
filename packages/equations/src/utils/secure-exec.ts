import { Logger } from '@nestjs/common'
import { spawn } from 'child_process'
import path from 'path'

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface ExecOptions {
  cwd?: string
  timeout?: number
  env?: Record<string, string>
  maxBuffer?: number
}

export class SecureExecutor {
  private readonly logger = new Logger(SecureExecutor.name)

  /**
   * Safely execute a command without using shell
   * Prevents command injection by using spawn without shell option
   */
  async safeExec(
    command: string,
    args: string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const {
      cwd,
      timeout = 15000,
      env = {},
      maxBuffer = 1024 * 1024, // 1MB max buffer
    } = options

    // Validate command is in allowed list
    const allowedCommands = ['pdflatex', 'convert', 'magick']
    if (!allowedCommands.includes(command)) {
      throw new Error(`Command '${command}' is not allowed`)
    }

    // Sanitize arguments - ensure no shell metacharacters
    const sanitizedArgs = args.map(arg => this.sanitizeArgument(arg))

    this.logger.log(
      {
        command,
        args: sanitizedArgs,
        cwd,
        timeout,
      },
      'Executing secure command',
    )

    return new Promise((resolve, reject) => {
      const child = spawn(command, sanitizedArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'], // No stdin, capture stdout/stderr
        shell: false, // Critical: never use shell
        timeout,
        env: {
          ...process.env,
          ...env,
          // Security: Remove potentially dangerous env vars
          PATH: '/usr/local/bin:/usr/bin:/bin',
          LD_LIBRARY_PATH: undefined,
          LD_PRELOAD: undefined,
        },
        detached: false,
        uid: process.getuid?.(), // Maintain current user
        gid: process.getgid?.(), // Maintain current group
      })

      let stdout = ''
      let stderr = ''
      let isTimedOut = false

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        isTimedOut = true
        child.kill('SIGKILL')
        reject(new Error(`Command timed out after ${timeout}ms`))
      }, timeout)

      // Collect stdout with size limits
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
        if (stdout.length > maxBuffer) {
          child.kill('SIGKILL')
          reject(new Error('Output buffer exceeded maximum size'))
        }
      })

      // Collect stderr with size limits
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
        if (stderr.length > maxBuffer) {
          child.kill('SIGKILL')
          reject(new Error('Error buffer exceeded maximum size'))
        }
      })

      child.on('error', error => {
        clearTimeout(timeoutHandle)
        if (!isTimedOut) {
          this.logger.error(
            { command, args: sanitizedArgs, error: error.message },
            'Command execution failed',
          )
          reject(error)
        }
      })

      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle)
        if (!isTimedOut) {
          const result: ExecResult = {
            stdout,
            stderr,
            exitCode: code ?? -1,
          }

          if (code === 0) {
            this.logger.log(
              { command, exitCode: code },
              'Command executed successfully',
            )
            resolve(result)
          } else {
            this.logger.error(
              {
                command,
                args: sanitizedArgs,
                exitCode: code,
                signal,
                stderr: stderr.substring(0, 500), // Log first 500 chars of error
              },
              'Command failed',
            )
            reject(
              new Error(
                `Command failed with exit code ${code}: ${stderr.substring(0, 200)}`,
              ),
            )
          }
        }
      })
    })
  }

  /**
   * Sanitize command line arguments to prevent injection
   */
  private sanitizeArgument(arg: string): string {
    // Check for known safe ImageMagick patterns first
    const safeImageMagickPatterns = [
      /^\d+x\d+>?$/, // resize patterns like 8000x8000 or 8000x8000>
      /^-?\d+(\.\d+)?x-?\d+(\.\d+)?[+-]\d+(\.\d+)?[+-]\d+(\.\d+)?$/, // unsharp mask patterns
      /^[a-zA-Z0-9._-]+$/, // basic alphanumeric with safe chars
      /^-[a-zA-Z0-9._-]+$/, // ImageMagick flags
      /^\+[a-zA-Z0-9._-]+$/, // ImageMagick plus flags
      /^\d+%?$/, // percentages and numbers
      /^#[0-9a-fA-F]{6}$/, // hex colors
      /^rgb\(\d+,\d+,\d+\)$/, // rgb colors
    ]

    // Allow known safe patterns
    for (const pattern of safeImageMagickPatterns) {
      if (pattern.test(arg)) {
        return arg
      }
    }

    // Remove or escape dangerous characters for other args
    const dangerous = /[;&|`$(){}[\]'"\\]/g
    if (dangerous.test(arg)) {
      this.logger.warn(
        { arg },
        'Argument contains potentially dangerous characters',
      )
      // For file paths, use basename only
      if (arg.includes('/') || arg.includes('\\')) {
        return path.basename(arg)
      }
      // For other args, remove dangerous chars (but preserve < and > for ImageMagick)
      return arg.replace(dangerous, '')
    }
    return arg
  }

  /**
   * Execute pdflatex with security restrictions using local pdflatex
   */
  async compilePdfLatex(
    texFile: string,
    workingDir: string,
  ): Promise<ExecResult> {
    const filename = path.basename(texFile)

    // First, compile LaTeX to PDF
    const pdfResult = await this.safeExec(
      'pdflatex',
      [
        '-no-shell-escape', // Critical: disable shell escape
        '-halt-on-error', // Stop on first error
        '-interaction=nonstopmode', // Don't wait for user input
        '-file-line-error', // Better error reporting
        '-output-directory=.', // Output to current dir only
        filename, // Use basename only
      ],
      {
        cwd: workingDir,
        timeout: 15000,
        env: {
          TEXMFOUTPUT: workingDir, // Restrict output location
          openout_any: 'r', // Restricted file output mode
          openin_any: 'a', // Allow file input mode (needed for /dev/null)
        },
      },
    )

    // If PDF compilation succeeded, convert to PNG
    if (pdfResult.exitCode === 0) {
      const pdfFile = path.join(
        workingDir,
        path.basename(texFile, '.tex') + '.pdf',
      )
      const pngFile = path.join(
        workingDir,
        path.basename(texFile, '.tex') + '.png',
      )

      try {
        await this.safeExec(
          'convert',
          [
            '-density',
            '600', // Higher density for better text quality
            path.basename(pdfFile),
            '-quality',
            '100',
            '-background',
            'white',
            '-alpha',
            'remove',
            '-alpha',
            'off', // Ensure alpha is completely off
            '-flatten',
            '-colorspace',
            'sRGB', // Use sRGB for better color consistency
            '-depth',
            '8', // Ensure 8-bit depth
            '-trim',
            '+repage', // Reset page geometry after trim
            '-bordercolor',
            'white',
            '-border',
            '40x40',
            '-format',
            'png32', // Force PNG32 format
            path.basename(pngFile),
          ],
          {
            cwd: workingDir,
            timeout: 30000,
            env: {
              MAGICK_MEMORY_LIMIT: '2GB',
              MAGICK_MAP_LIMIT: '4GB',
              MAGICK_DISK_LIMIT: '8GB',
              MAGICK_TIME_LIMIT: '120',
            },
          },
        )
      } catch (convertError) {
        this.logger.error(
          { error: (convertError as Error).message },
          'PDF to PNG conversion failed',
        )
        // Return the PDF compilation result even if PNG conversion fails
        // The caller can handle the missing PNG file
      }
    }

    return pdfResult
  }

  /**
   * Execute ImageMagick convert with security restrictions using local convert
   */
  async convertImage(
    inputFile: string,
    outputFile: string,
    workingDir: string,
  ): Promise<ExecResult> {
    const inputBasename = path.basename(inputFile)
    const outputBasename = path.basename(outputFile)

    return this.safeExec(
      'convert',
      [
        inputBasename,
        '-resize',
        '4000x4000>', // High resolution but more reasonable
        '-quality',
        '95',
        '-colorspace',
        'sRGB', // Maintain color space consistency
        '-depth',
        '8', // Maintain bit depth
        '-define',
        'png:compression-level=6',
        '-define',
        'png:color-type=2', // Force RGB without alpha
        outputBasename,
      ],
      {
        cwd: workingDir,
        timeout: 30000,
        env: {
          MAGICK_MEMORY_LIMIT: '2GB',
          MAGICK_MAP_LIMIT: '4GB',
          MAGICK_DISK_LIMIT: '8GB',
          MAGICK_TIME_LIMIT: '120',
        },
      },
    )
  }
}
