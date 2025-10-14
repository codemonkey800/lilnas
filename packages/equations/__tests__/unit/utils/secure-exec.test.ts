import { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { SecureExecutor } from 'src/utils/secure-exec'

// Constants for buffer sizes
const MAX_BUFFER = 1024 * 1024 // 1MB
const OVER_MAX_BUFFER = MAX_BUFFER + 1000
const SAFE_BUFFER = 500 * 1024

// Mock child_process
const mockSpawn = jest.fn()
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock NestJS Logger to suppress console output
jest.mock('@nestjs/common', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}))

interface MockChildProcessConfig {
  stdout?: string
  stderr?: string
  exitCode?: number
  signal?: string
  error?: Error
  delay?: number
  stdoutDelay?: number
  stderrDelay?: number
  largeStdout?: boolean
  largeStderr?: boolean
}

/**
 * Create a mock child process that simulates spawn behavior
 */
function createMockChildProcess(config: MockChildProcessConfig = {}) {
  const mockChild = new EventEmitter() as ChildProcess & EventEmitter
  const mockStdout = new EventEmitter()
  const mockStderr = new EventEmitter()

  mockChild.stdout = mockStdout as any
  mockChild.stderr = mockStderr as any
  mockChild.kill = jest.fn()

  // Simulate process execution
  setImmediate(() => {
    // Emit error if configured
    if (config.error) {
      mockChild.emit('error', config.error)
      return
    }

    // Emit stdout data immediately if large (for buffer overflow tests)
    if (config.largeStdout) {
      const largeData = 'x'.repeat(OVER_MAX_BUFFER)
      mockStdout.emit('data', Buffer.from(largeData))
      return // Don't emit close event, the kill should happen
    }

    // Emit stderr data immediately if large (for buffer overflow tests)
    if (config.largeStderr) {
      const largeData = 'x'.repeat(OVER_MAX_BUFFER)
      mockStderr.emit('data', Buffer.from(largeData))
      return // Don't emit close event, the kill should happen
    }

    // Emit stdout data
    if (config.stdout !== undefined) {
      const delay = config.stdoutDelay ?? 0
      setTimeout(() => {
        mockStdout.emit('data', Buffer.from(config.stdout!))
      }, delay)
    }

    // Emit stderr data
    if (config.stderr !== undefined) {
      const delay = config.stderrDelay ?? 0
      setTimeout(() => {
        mockStderr.emit('data', Buffer.from(config.stderr!))
      }, delay)
    }

    // Emit close event
    const closeDelay = config.delay ?? 10
    setTimeout(() => {
      const exitCode = config.exitCode !== undefined ? config.exitCode : 0
      mockChild.emit('close', exitCode, config.signal ?? null)
    }, closeDelay)
  })

  return mockChild
}

/**
 * Helper to test that dangerous arguments are sanitized
 */
async function testDangerousArgSanitization(
  executor: SecureExecutor,
  dangerousArg: string,
  expectedNotToContain: string | RegExp,
) {
  const mockChild = createMockChildProcess({ stdout: 'success', exitCode: 0 })
  mockSpawn.mockReturnValue(mockChild)

  await executor.safeExec('pdflatex', [dangerousArg])

  const sanitizedArgs = mockSpawn.mock.calls[0][1]
  if (typeof expectedNotToContain === 'string') {
    expect(sanitizedArgs[0]).not.toContain(expectedNotToContain)
  } else {
    expect(sanitizedArgs[0]).not.toMatch(expectedNotToContain)
  }
}

/**
 * Helper to test environment variable security
 */
async function testEnvVarSecurity(
  executor: SecureExecutor,
  customEnv: Record<string, string>,
  expectedEnvState: Record<string, string | undefined>,
) {
  const mockChild = createMockChildProcess({ stdout: 'success', exitCode: 0 })
  mockSpawn.mockReturnValue(mockChild)

  await executor.safeExec('pdflatex', ['test.tex'], { env: customEnv })

  const spawnOptions = mockSpawn.mock.calls[0][2]
  for (const [key, expectedValue] of Object.entries(expectedEnvState)) {
    expect(spawnOptions.env[key]).toBe(expectedValue)
  }
}

describe('SecureExecutor', () => {
  let executor: SecureExecutor

  beforeEach(() => {
    executor = new SecureExecutor()
    mockSpawn.mockReset()
    jest.clearAllTimers()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('safeExec - Command Whitelisting', () => {
    test('should allow pdflatex command', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.safeExec('pdflatex', ['test.tex']),
      ).resolves.toBeDefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'pdflatex',
        ['test.tex'],
        expect.any(Object),
      )
    })

    test('should allow convert command', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.safeExec('convert', ['input.pdf', 'output.png']),
      ).resolves.toBeDefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'convert',
        expect.any(Array),
        expect.any(Object),
      )
    })

    test('should allow magick command', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.safeExec('magick', ['convert', 'input.pdf', 'output.png']),
      ).resolves.toBeDefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'magick',
        expect.any(Array),
        expect.any(Object),
      )
    })

    test('should reject disallowed commands', async () => {
      const disallowedCommands = ['node', 'bash', 'sh', 'rm', 'cat', 'curl']

      for (const cmd of disallowedCommands) {
        await expect(executor.safeExec(cmd, [])).rejects.toThrow(
          `Command '${cmd}' is not allowed`,
        )
      }

      // spawn should never be called for disallowed commands
      expect(mockSpawn).not.toHaveBeenCalled()
    })
  })

  describe('safeExec - Argument Sanitization', () => {
    test('should preserve safe ImageMagick resize patterns', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const safePatterns = ['8000x8000', '4000x4000>', '100%', '50%']

      for (const pattern of safePatterns) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('convert', ['input.png', '-resize', pattern])

        expect(mockSpawn).toHaveBeenCalledWith(
          'convert',
          expect.arrayContaining([pattern]),
          expect.any(Object),
        )
      }
    })

    test('should preserve safe ImageMagick color patterns', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const colorPatterns = ['#FF0000', '#00ff00', 'rgb(255,0,0)']

      for (const color of colorPatterns) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('convert', ['input.png', '-fill', color])

        expect(mockSpawn).toHaveBeenCalledWith(
          'convert',
          expect.arrayContaining([color]),
          expect.any(Object),
        )
      }
    })

    test('should sanitize dangerous arguments without paths', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Arguments with only dangerous characters (no path separators) should have them removed
      await executor.safeExec('pdflatex', ['test;echo;whoami'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Dangerous characters should be removed
      expect(sanitizedArgs[0]).not.toContain(';')
      expect(sanitizedArgs[0]).toBe('testechowhoami')
    })

    test('should extract basename from path traversal attempts with dangerous chars', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Path with dangerous characters triggers basename extraction AND dangerous char removal
      await executor.safeExec('pdflatex', ['../../etc/passwd;whoami'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Should extract basename AND remove dangerous chars
      expect(sanitizedArgs[0]).toBe('passwdwhoami')
    })

    test('should remove dangerous characters from general arguments', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const dangerousArgs = [
        'test`whoami`',
        'test$(whoami)',
        'test&&ls',
        'test||echo',
        'test|grep',
      ]

      for (const arg of dangerousArgs) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('pdflatex', [arg])

        const sanitizedArgs = mockSpawn.mock.calls[0][1]
        // Should not contain the original dangerous arg
        expect(sanitizedArgs).not.toContain(arg)
      }
    })

    test('should preserve safe alphanumeric arguments', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const safeArgs = [
        'test.tex',
        'output_file.pdf',
        'my-document-123',
        '+page',
      ]

      await executor.safeExec('pdflatex', safeArgs)

      expect(mockSpawn).toHaveBeenCalledWith(
        'pdflatex',
        safeArgs,
        expect.any(Object),
      )
    })

    test('should extract basename from path traversal without dangerous chars', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Pure path traversal without dangerous characters
      await executor.safeExec('pdflatex', ['../../etc/passwd'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Should still use basename only for path traversal
      expect(sanitizedArgs[0]).toBe('passwd')
    })

    test('should handle empty string arguments', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['', 'test.tex', ''])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs).toEqual(['', 'test.tex', ''])
    })

    test('should handle unicode filenames', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['документ.tex', '文档.tex'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs).toEqual(['документ.tex', '文档.tex'])
    })

    test('should handle extremely long arguments', async () => {
      const longArg = 'a'.repeat(10000)
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', [longArg])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs[0]).toBeDefined()
      expect(sanitizedArgs[0].length).toBeLessThanOrEqual(10000)
    })
  })

  describe('safeExec - Path Traversal Attack Variants', () => {
    test('should sanitize multiple levels of path traversal', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const attacks = [
        '../../../etc/passwd',
        '../../../../etc/shadow',
        '..\\..\\..\\windows\\system32\\config\\sam',
        './../../../secret',
      ]

      for (const attack of attacks) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('pdflatex', [attack])

        const sanitizedArgs = mockSpawn.mock.calls[0][1]
        // Should only keep the basename
        expect(sanitizedArgs[0]).not.toContain('..')
        expect(sanitizedArgs[0]).not.toContain('/')
        expect(sanitizedArgs[0]).not.toContain('\\')
      }
    })

    test('should handle embedded path traversal patterns', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['./normal/../../../etc/passwd'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs[0]).toBe('passwd')
      expect(sanitizedArgs[0]).not.toContain('..')
    })

    test('should handle mixed forward and backward slashes', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['..\\../etc/passwd'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs[0]).toBe('passwd')
      expect(sanitizedArgs[0]).not.toContain('..')
    })

    test('should handle URL-encoded path traversal (decoded by app layer)', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Simulate pre-decoded URL encoding
      const decoded = '../etc/passwd'
      await executor.safeExec('pdflatex', [decoded])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs[0]).toBe('passwd')
    })

    test('should handle absolute paths attempting to access system files', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const absolutePaths = [
        '/etc/passwd',
        '/root/.ssh/id_rsa',
        'C:\\Windows\\System32\\config\\SAM',
      ]

      for (const absPath of absolutePaths) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('pdflatex', [absPath])

        const sanitizedArgs = mockSpawn.mock.calls[0][1]
        // Should only keep the basename, not the absolute path
        expect(sanitizedArgs[0]).not.toContain('/')
        expect(sanitizedArgs[0]).not.toContain('\\')
      }
    })

    test('should handle absolute paths without dangerous characters', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const safePaths = ['/tmp/safe.tex', 'C:\\Users\\Documents\\file.tex']

      for (const safePath of safePaths) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('pdflatex', [safePath])

        const sanitizedArgs = mockSpawn.mock.calls[0][1]
        // Should use basename only for all absolute paths
        expect(sanitizedArgs[0]).not.toContain('/')
        expect(sanitizedArgs[0]).not.toContain('\\')
        // Should have just the filename
        expect(['safe.tex', 'file.tex']).toContain(sanitizedArgs[0])
      }
    })
  })

  describe('safeExec - Command Injection Attempts', () => {
    test('should sanitize null byte injection attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test\x00whoami'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Null bytes should be removed
      expect(sanitizedArgs[0]).not.toContain('\x00')
      expect(sanitizedArgs[0]).toBe('testwhoami')
    })

    test('should sanitize newline injection attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test\nwhoami'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Newlines should be removed
      expect(sanitizedArgs[0]).not.toContain('\n')
    })

    test('should sanitize carriage return injection attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test\rwhoami'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Carriage returns should be removed
      expect(sanitizedArgs[0]).not.toContain('\r')
    })

    test('should sanitize IFS exploitation attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test${IFS}whoami'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Shell variables should be removed
      expect(sanitizedArgs[0]).not.toContain('${IFS}')
      expect(sanitizedArgs[0]).not.toContain('$')
    })

    test('should sanitize multiple injection vectors in one argument', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test;whoami|cat`id`$(ls)'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // All dangerous chars should be removed
      expect(sanitizedArgs[0]).not.toContain(';')
      expect(sanitizedArgs[0]).not.toContain('|')
      expect(sanitizedArgs[0]).not.toContain('`')
      expect(sanitizedArgs[0]).not.toContain('$')
      expect(sanitizedArgs[0]).not.toContain('(')
      expect(sanitizedArgs[0]).not.toContain(')')
    })

    test('should handle tab and form feed characters', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test\twhoami\fmalicious'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Whitespace control chars should be preserved or handled safely
      expect(sanitizedArgs[0]).toBeDefined()
    })

    test('should handle arguments with only dangerous characters', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', [';;;|||```'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Should result in empty string or removed chars
      expect(sanitizedArgs[0]).not.toMatch(/[;|`]/)
    })
  })

  describe('safeExec - ImageMagick-Specific Attack Vectors', () => {
    test('should reject ephemeral coder attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('convert', ['ephemeral:/tmp/evil', 'output.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Dangerous coders should be sanitized
      // Since it contains : and / (dangerous chars) and has /, basename is extracted
      expect(sanitizedArgs[0]).not.toContain(':')
      expect(sanitizedArgs[0]).not.toContain('/')
      expect(sanitizedArgs[0]).toBe('evil')
    })

    test('should reject MSL injection attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('convert', ['msl:script.xml', 'output.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // MSL coder should be sanitized
      expect(sanitizedArgs[0]).not.toContain('msl:')
    })

    test('should reject text coder file read attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('convert', ['text:@/etc/passwd', 'output.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // @ file read syntax should be sanitized
      expect(sanitizedArgs[0]).not.toContain('@')
      expect(sanitizedArgs[0]).not.toContain(':')
    })

    test('should reject URL handler attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const urls = [
        'https://evil.com/image.png',
        'http://attacker.com/payload',
        'ftp://evil.com/file',
      ]

      for (const url of urls) {
        mockSpawn.mockClear()
        mockSpawn.mockReturnValue(
          createMockChildProcess({ stdout: 'success', exitCode: 0 }),
        )

        await executor.safeExec('convert', [url, 'output.png'])

        const sanitizedArgs = mockSpawn.mock.calls[0][1]
        // Should not contain protocol handlers
        expect(sanitizedArgs[0]).not.toContain('://')
      }
    })

    test('should reject label injection with shell metacharacters', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('convert', ['-label', '$(whoami)', 'output.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Shell command substitution should be removed
      expect(sanitizedArgs).not.toContain('$(whoami)')
      // The $(whoami) should have dangerous chars removed
      const labelArg = sanitizedArgs.find((arg: string) =>
        arg.includes('whoami'),
      )
      if (labelArg) {
        expect(labelArg).not.toContain('$')
        expect(labelArg).not.toContain('(')
        expect(labelArg).not.toContain(')')
      }
    })

    test('should sanitize delegate exploitation attempts', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('convert', ['ps:payload.ps', 'output.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Delegate coders should be sanitized
      expect(sanitizedArgs[0]).not.toContain('ps:')
    })

    test('should handle pipe character in filenames safely', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('convert', ['input|malicious', 'output.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Pipe should be removed
      expect(sanitizedArgs[0]).not.toContain('|')
    })

    test('should reject invalid use of > character outside resize context', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Attempt shell redirection disguised as filename
      await executor.safeExec('convert', ['test>output.txt', 'result.png'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // > should be removed from filenames (not a valid resize pattern)
      expect(sanitizedArgs[0]).not.toContain('>')
      expect(sanitizedArgs[0]).toBe('testoutput.txt')
    })
  })

  describe('safeExec - Execution Success', () => {
    test('should capture and return stdout', async () => {
      const expectedStdout = 'Command executed successfully'
      const mockChild = createMockChildProcess({
        stdout: expectedStdout,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const result = await executor.safeExec('pdflatex', ['test.tex'])

      expect(result.stdout).toBe(expectedStdout)
      expect(result.exitCode).toBe(0)
    })

    test('should capture and return stderr', async () => {
      const expectedStderr = 'Warning: some non-fatal warning'
      const mockChild = createMockChildProcess({
        stderr: expectedStderr,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const result = await executor.safeExec('pdflatex', ['test.tex'])

      expect(result.stderr).toBe(expectedStderr)
      expect(result.exitCode).toBe(0)
    })

    test('should capture stderr warnings even on success', async () => {
      const expectedStdout = 'LaTeX compilation successful'
      const expectedStderr =
        'LaTeX Warning: Reference `fig:missing` on page 1 undefined'
      const mockChild = createMockChildProcess({
        stdout: expectedStdout,
        stderr: expectedStderr,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const result = await executor.safeExec('pdflatex', ['test.tex'])

      expect(result.stdout).toBe(expectedStdout)
      expect(result.stderr).toBe(expectedStderr)
      expect(result.exitCode).toBe(0)
      // Verify both streams are captured simultaneously
      expect(result.stderr).toContain('Warning')
      expect(result.stdout).toContain('successful')
    })

    test('should return correct exit code for successful execution', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const result = await executor.safeExec('pdflatex', ['test.tex'])

      expect(result.exitCode).toBe(0)
    })
  })

  describe('safeExec - Error Handling', () => {
    test('should reject on non-zero exit code', async () => {
      const mockChild = createMockChildProcess({
        stderr: 'Compilation failed',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(executor.safeExec('pdflatex', ['test.tex'])).rejects.toThrow(
        'Command failed with exit code 1',
      )
    })

    test('should reject on process spawn error', async () => {
      const spawnError = new Error('Command not found')
      const mockChild = createMockChildProcess({ error: spawnError })
      mockSpawn.mockReturnValue(mockChild)

      await expect(executor.safeExec('pdflatex', ['test.tex'])).rejects.toThrow(
        'Command not found',
      )
    })

    test('should include stderr in error message', async () => {
      const errorMessage = 'LaTeX Error: File not found'
      const mockChild = createMockChildProcess({
        stderr: errorMessage,
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(executor.safeExec('pdflatex', ['test.tex'])).rejects.toThrow(
        errorMessage,
      )
    })

    test('should handle signal termination', async () => {
      const mockChild = createMockChildProcess({
        exitCode: null as any,
        signal: 'SIGTERM',
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.safeExec('pdflatex', ['test.tex']),
      ).rejects.toThrow()
    })
  })

  describe('safeExec - Timeout Enforcement', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('should use default 15s timeout', async () => {
      const mockChild = createMockChildProcess({
        delay: 20000, // 20 seconds
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      // Flush immediate callbacks
      await Promise.resolve()
      jest.runOnlyPendingTimers()

      // Fast-forward time past the default timeout
      jest.advanceTimersByTime(15000)

      await expect(promise).rejects.toThrow('Command timed out after 15000ms')
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    test('should respect custom timeout', async () => {
      const customTimeout = 5000
      const mockChild = createMockChildProcess({
        delay: 10000, // 10 seconds
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'], {
        timeout: customTimeout,
      })

      // Flush immediate callbacks
      await Promise.resolve()
      jest.runOnlyPendingTimers()

      // Fast-forward past custom timeout
      jest.advanceTimersByTime(customTimeout)

      await expect(promise).rejects.toThrow(
        `Command timed out after ${customTimeout}ms`,
      )
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    test('should kill process with SIGKILL on timeout', async () => {
      const mockChild = createMockChildProcess({
        delay: 20000,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      // Flush immediate callbacks
      await Promise.resolve()
      jest.runOnlyPendingTimers()

      jest.advanceTimersByTime(15000)

      await expect(promise).rejects.toThrow()
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })
  })

  describe('safeExec - Race Conditions', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('should handle buffer overflow occurring during timeout', async () => {
      const mockChild = new EventEmitter() as ChildProcess & EventEmitter
      const mockStdout = new EventEmitter()
      const mockStderr = new EventEmitter()
      mockChild.stdout = mockStdout as any
      mockChild.stderr = mockStderr as any
      mockChild.kill = jest.fn()
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      // Emit large data immediately
      setImmediate(() => {
        mockStdout.emit('data', Buffer.from('x'.repeat(OVER_MAX_BUFFER)))
      })

      // Run pending timers and immediates
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()

      // Should reject with buffer overflow (happens first)
      await expect(promise).rejects.toThrow(
        'Output buffer exceeded maximum size',
      )
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    test('should handle spawn error occurring during timeout', async () => {
      const mockChild = new EventEmitter() as ChildProcess & EventEmitter
      const mockStdout = new EventEmitter()
      const mockStderr = new EventEmitter()
      mockChild.stdout = mockStdout as any
      mockChild.stderr = mockStderr as any
      mockChild.kill = jest.fn()
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      // Emit error immediately
      const spawnError = new Error('ENOENT: command not found')
      setImmediate(() => {
        mockChild.emit('error', spawnError)
      })

      // Run pending timers and immediates
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()

      // Should reject with spawn error (happens first)
      await expect(promise).rejects.toThrow('ENOENT: command not found')
    })

    test('should handle close event racing with kill signal', async () => {
      const mockChild = new EventEmitter() as ChildProcess & EventEmitter
      const mockStdout = new EventEmitter()
      const mockStderr = new EventEmitter()
      mockChild.stdout = mockStdout as any
      mockChild.stderr = mockStderr as any
      mockChild.kill = jest.fn()
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      setImmediate(() => {
        // Emit close event just as timeout is about to trigger
        setTimeout(() => {
          mockChild.emit('close', 0, null)
        }, 14990)
      })

      // Run all pending timers and immediates
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()

      // Should handle gracefully regardless of which wins the race
      await expect(promise).resolves.toBeDefined()
    })

    test('should not reject twice on multiple error events', async () => {
      const mockChild = new EventEmitter() as ChildProcess & EventEmitter
      const mockStdout = new EventEmitter()
      const mockStderr = new EventEmitter()
      mockChild.stdout = mockStdout as any
      mockChild.stderr = mockStderr as any
      mockChild.kill = jest.fn()
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      setImmediate(() => {
        // Emit buffer overflow
        mockStdout.emit('data', Buffer.from('x'.repeat(OVER_MAX_BUFFER)))
        // Then emit error
        mockChild.emit('error', new Error('Some error'))
        // Then emit close
        mockChild.emit('close', 1, null)
      })

      // Run all pending timers and immediates
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()

      // Should only reject once with the first error (buffer overflow)
      await expect(promise).rejects.toThrow(
        'Output buffer exceeded maximum size',
      )
    })

    test('should ignore data received after close event', async () => {
      const mockChild = new EventEmitter() as ChildProcess & EventEmitter
      const mockStdout = new EventEmitter()
      const mockStderr = new EventEmitter()
      mockChild.stdout = mockStdout as any
      mockChild.stderr = mockStderr as any
      mockChild.kill = jest.fn()
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      setImmediate(() => {
        // Emit some initial data
        mockStdout.emit('data', Buffer.from('initial data'))
        // Emit close event
        mockChild.emit('close', 0, null)
        // Emit late data after close
        mockStdout.emit('data', Buffer.from(' late data'))
      })

      // Run all pending timers and immediates
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()

      const result = await promise
      // Should only include initial data, not late data
      expect(result.stdout).toBe('initial data')
      expect(result.stdout).not.toContain('late data')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('safeExec - Buffer Size Limits', () => {
    test('should reject when stdout exceeds 1MB buffer', async () => {
      const mockChild = createMockChildProcess({
        largeStdout: true,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(executor.safeExec('pdflatex', ['test.tex'])).rejects.toThrow(
        'Output buffer exceeded maximum size',
      )
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    test('should reject when stderr exceeds 1MB buffer', async () => {
      const mockChild = createMockChildProcess({
        largeStderr: true,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(executor.safeExec('pdflatex', ['test.tex'])).rejects.toThrow(
        'Error buffer exceeded maximum size',
      )
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    test('should accept output within buffer limits', async () => {
      // 500KB of data - well within the 1MB limit
      const largeButValidOutput = 'x'.repeat(SAFE_BUFFER)
      const mockChild = createMockChildProcess({
        stdout: largeButValidOutput,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const result = await executor.safeExec('pdflatex', ['test.tex'])

      expect(result.stdout).toBe(largeButValidOutput)
      expect(result.exitCode).toBe(0)
    })

    test('should reject when buffer fills gradually', async () => {
      const mockChild = new EventEmitter() as ChildProcess & EventEmitter
      const mockStdout = new EventEmitter()
      const mockStderr = new EventEmitter()
      mockChild.stdout = mockStdout as any
      mockChild.stderr = mockStderr as any
      mockChild.kill = jest.fn()
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.safeExec('pdflatex', ['test.tex'])

      setImmediate(() => {
        // Emit data in chunks that gradually exceed 1MB
        for (let i = 0; i < 10; i++) {
          mockStdout.emit('data', Buffer.from('x'.repeat(110 * 1024)))
        }
      })

      await expect(promise).rejects.toThrow(
        'Output buffer exceeded maximum size',
      )
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })
  })

  describe('safeExec - Working Directory', () => {
    test('should use specified cwd option', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const testCwd = '/tmp/test-dir'
      await executor.safeExec('pdflatex', ['test.tex'], { cwd: testCwd })

      expect(mockSpawn).toHaveBeenCalledWith(
        'pdflatex',
        expect.any(Array),
        expect.objectContaining({ cwd: testCwd }),
      )
    })

    test('should work without cwd option', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      expect(mockSpawn).toHaveBeenCalledWith(
        'pdflatex',
        expect.any(Array),
        expect.objectContaining({ cwd: undefined }),
      )
    })
  })

  describe('safeExec - Process Cleanup', () => {
    test('should clear timeout on successful completion', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    test('should clear timeout on error', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
      const mockChild = createMockChildProcess({
        stderr: 'Error',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.safeExec('pdflatex', ['test.tex']),
      ).rejects.toThrow()

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    test('should clear timeout on spawn error', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
      const mockChild = createMockChildProcess({
        error: new Error('Command not found'),
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.safeExec('pdflatex', ['test.tex']),
      ).rejects.toThrow()

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    test('should kill process on buffer overflow', async () => {
      const mockChild = createMockChildProcess({
        largeStdout: true,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(executor.safeExec('pdflatex', ['test.tex'])).rejects.toThrow(
        'Output buffer exceeded maximum size',
      )

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    test('should not leak event listeners on successful execution', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const removeListenerSpy = jest.spyOn(mockChild, 'removeAllListeners')

      await executor.safeExec('pdflatex', ['test.tex'])

      // Process should complete cleanly
      expect(mockChild.listenerCount('error')).toBeLessThanOrEqual(1)
      expect(mockChild.listenerCount('close')).toBeLessThanOrEqual(1)
    })
  })

  describe('safeExec - Environment Variable Sanitization', () => {
    test('should remove LD_PRELOAD from environment', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.LD_PRELOAD).toBeUndefined()
    })

    test('should remove LD_LIBRARY_PATH from environment', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.LD_LIBRARY_PATH).toBeUndefined()
    })

    test('should set restricted PATH', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin')
    })

    test('should pass custom environment variables', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const customEnv = { CUSTOM_VAR: 'test-value', ANOTHER_VAR: '123' }
      await executor.safeExec('pdflatex', ['test.tex'], { env: customEnv })

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.CUSTOM_VAR).toBe('test-value')
      expect(spawnOptions.env.ANOTHER_VAR).toBe('123')
    })

    test('should maintain current uid/gid', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.uid).toBe(process.getuid?.())
      expect(spawnOptions.gid).toBe(process.getgid?.())
    })

    test('should prevent custom env from overriding PATH with dangerous values', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'], {
        env: { PATH: '/tmp:/evil/path' },
      })

      const spawnOptions = mockSpawn.mock.calls[0][2]
      // Should use the hardcoded safe PATH, not the user-provided one
      expect(spawnOptions.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin')
    })

    test('should prevent setting LD_PRELOAD via custom env', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'], {
        env: { LD_PRELOAD: '/tmp/evil.so' },
      })

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.LD_PRELOAD).toBeUndefined()
    })

    test('should prevent setting LD_LIBRARY_PATH via custom env', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'], {
        env: { LD_LIBRARY_PATH: '/tmp/evil' },
      })

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.LD_LIBRARY_PATH).toBeUndefined()
    })

    test('should handle empty string environment values', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'], {
        env: { CUSTOM_VAR: '' },
      })

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.CUSTOM_VAR).toBe('')
    })

    test('should handle very large environment variable values', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const largeValue = 'x'.repeat(100000)
      await executor.safeExec('pdflatex', ['test.tex'], {
        env: { LARGE_VAR: largeValue },
      })

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.LARGE_VAR).toBe(largeValue)
    })

    test('should inherit safe environment variables from process.env', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Temporarily set a safe env var
      const originalValue = process.env.CUSTOM_SAFE_VAR
      process.env.CUSTOM_SAFE_VAR = 'inherited_value'

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      // Should inherit from process.env
      expect(spawnOptions.env.CUSTOM_SAFE_VAR).toBe('inherited_value')

      // Restore original value
      if (originalValue !== undefined) {
        process.env.CUSTOM_SAFE_VAR = originalValue
      } else {
        delete process.env.CUSTOM_SAFE_VAR
      }
    })

    test('should not inherit dangerous env vars from process.env', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Temporarily set dangerous env vars
      const originalLdPreload = process.env.LD_PRELOAD
      const originalLdLibPath = process.env.LD_LIBRARY_PATH
      process.env.LD_PRELOAD = '/tmp/evil.so'
      process.env.LD_LIBRARY_PATH = '/tmp/evil'

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.LD_PRELOAD).toBeUndefined()
      expect(spawnOptions.env.LD_LIBRARY_PATH).toBeUndefined()

      // Restore original values
      if (originalLdPreload !== undefined) {
        process.env.LD_PRELOAD = originalLdPreload
      } else {
        delete process.env.LD_PRELOAD
      }
      if (originalLdLibPath !== undefined) {
        process.env.LD_LIBRARY_PATH = originalLdLibPath
      } else {
        delete process.env.LD_LIBRARY_PATH
      }
    })
  })

  describe('safeExec - Spawn Options Validation', () => {
    test('should enforce shell: false', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.shell).toBe(false)
    })

    test('should configure stdio correctly', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    })

    test('should set detached to false', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.safeExec('pdflatex', ['test.tex'])

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.detached).toBe(false)
    })
  })

  describe('safeExec - Concurrent Execution', () => {
    test('should handle concurrent executions safely', async () => {
      const promises = Array.from({ length: 5 }, (_, i) => {
        const mockChild = createMockChildProcess({
          stdout: `result${i}`,
          exitCode: 0,
        })
        mockSpawn.mockReturnValueOnce(mockChild)
        return executor.safeExec('pdflatex', [`test${i}.tex`])
      })

      const results = await Promise.all(promises)
      expect(results).toHaveLength(5)
      results.forEach((result, i) => {
        expect(result.stdout).toBe(`result${i}`)
        expect(result.exitCode).toBe(0)
      })
    })

    test('should handle concurrent executions with mixed success/failure', async () => {
      const promises = Array.from({ length: 3 }, (_, i) => {
        const mockChild = createMockChildProcess({
          stdout: i === 1 ? '' : `result${i}`,
          stderr: i === 1 ? 'Error occurred' : '',
          exitCode: i === 1 ? 1 : 0,
        })
        mockSpawn.mockReturnValueOnce(mockChild)
        return executor.safeExec('pdflatex', [`test${i}.tex`]).catch(err => ({
          error: err.message,
          index: i,
        }))
      })

      const results = await Promise.all(promises)
      expect(results).toHaveLength(3)
      expect(results[0]).toHaveProperty('stdout', 'result0')
      expect(results[1]).toHaveProperty('error')
      expect(results[2]).toHaveProperty('stdout', 'result2')
    })
  })

  describe('safeExec - Homoglyph Attacks', () => {
    /**
     * Note on Homoglyph Handling:
     * The SecureExecutor intentionally passes through Unicode characters that visually
     * resemble ASCII characters (homoglyphs). This is acceptable because:
     *
     * 1. The sanitizer removes dangerous ASCII characters (;|`$, etc.) that could enable
     *    shell injection - homoglyphs of these don't have special meaning to the shell
     * 2. Path traversal is handled separately via basename extraction
     * 3. Command whitelisting prevents arbitrary command execution
     * 4. shell: false ensures no shell interpretation occurs
     *
     * Homoglyphs may cause confusion in logs/debugging but don't create security vulnerabilities
     * in this architecture. File system operations will simply treat them as unicode filenames.
     */

    test('should handle Cyrillic characters that look like Latin', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Cyrillic 'а' (U+0430) looks like Latin 'a' (U+0061)
      await executor.safeExec('pdflatex', ['tеst.tex']) // Contains Cyrillic 'е'

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Should be passed through as-is (just a filename with unicode)
      expect(sanitizedArgs[0]).toBeDefined()
    })

    test('should handle Greek characters that look like Latin', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Greek omicron (ο) looks like Latin 'o'
      await executor.safeExec('pdflatex', ['dοcument.tex'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs[0]).toBeDefined()
    })

    test('should handle fullwidth characters that look like ASCII', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Fullwidth semicolon (U+FF1B) looks like regular semicolon but is safe
      // It doesn't have special meaning to the shell since shell: false
      await executor.safeExec('pdflatex', ['test；whoami.tex'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Should be treated as safe unicode, not dangerous ASCII semicolon
      // This is safe because shell is disabled and only ASCII ; has special meaning
      expect(sanitizedArgs[0]).toContain('；')
    })

    test('should handle zero-width characters', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      // Zero-width space (U+200B)
      await executor.safeExec('pdflatex', ['test\u200B.tex'])

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      expect(sanitizedArgs[0]).toBeDefined()
    })
  })

  describe('compilePdfLatex Integration', () => {
    test('should execute pdflatex with correct security flags', async () => {
      const pdflatexMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      await executor.compilePdfLatex('test.tex', '/tmp/workdir')

      expect(mockSpawn).toHaveBeenCalledWith(
        'pdflatex',
        expect.arrayContaining([
          '-no-shell-escape',
          '-halt-on-error',
          '-interaction=nonstopmode',
          '-file-line-error',
          '-output-directory=.',
          'test.tex',
        ]),
        expect.any(Object),
      )
    })

    test('should set LaTeX-specific environment variables', async () => {
      const pdflatexMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      const workingDir = '/tmp/latex-workdir'
      await executor.compilePdfLatex('test.tex', workingDir)

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.TEXMFOUTPUT).toBe(workingDir)
      expect(spawnOptions.env.openout_any).toBe('r')
      expect(spawnOptions.env.openin_any).toBe('a')
    })

    test('should use 15 second timeout for pdflatex', async () => {
      const pdflatexMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      await executor.compilePdfLatex('test.tex', '/tmp/workdir')

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.timeout).toBe(15000)
    })

    test('should convert PDF to PNG after successful compilation', async () => {
      // First call for pdflatex
      const pdflatexMock = createMockChildProcess({
        stdout: 'PDF created successfully',
        exitCode: 0,
      })
      // Second call for convert
      const convertMock = createMockChildProcess({
        stdout: 'PNG created successfully',
        exitCode: 0,
      })

      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      await executor.compilePdfLatex('test.tex', '/tmp/workdir')

      // Should be called twice: once for pdflatex, once for convert
      expect(mockSpawn).toHaveBeenCalledTimes(2)
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'pdflatex',
        expect.any(Array),
        expect.any(Object),
      )
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        'convert',
        expect.any(Array),
        expect.any(Object),
      )
    })

    test('should handle PNG conversion failure gracefully', async () => {
      const pdflatexMock = createMockChildProcess({
        stdout: 'PDF created successfully',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        stderr: 'convert: unable to open image',
        exitCode: 1,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      const result = await executor.compilePdfLatex('test.tex', '/tmp/workdir')

      expect(result.exitCode).toBe(0) // PDF compilation succeeded
      expect(mockSpawn).toHaveBeenCalledTimes(2) // Both commands attempted
    })

    test('should handle pdflatex compilation failures', async () => {
      const mockChild = createMockChildProcess({
        stderr: 'LaTeX Error: Missing \\begin{document}',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.compilePdfLatex('test.tex', '/tmp/workdir'),
      ).rejects.toThrow('Command failed with exit code 1')
    })

    test('should handle pdflatex command not found', async () => {
      const mockChild = createMockChildProcess({
        error: new Error('ENOENT: pdflatex not found'),
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.compilePdfLatex('test.tex', '/tmp/workdir'),
      ).rejects.toThrow('ENOENT')
    })

    test('should handle pdflatex timeout', async () => {
      jest.useFakeTimers()

      const mockChild = createMockChildProcess({
        delay: 20000, // 20 seconds
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.compilePdfLatex('test.tex', '/tmp/workdir')

      await Promise.resolve()
      jest.runOnlyPendingTimers()
      jest.advanceTimersByTime(15000)

      await expect(promise).rejects.toThrow('Command timed out after 15000ms')
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')

      jest.useRealTimers()
    })

    test('should sanitize tex filename to basename', async () => {
      const pdflatexMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      await executor.compilePdfLatex('../../evil/test.tex', '/tmp/workdir')

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Should only use basename
      expect(sanitizedArgs).toContain('test.tex')
      expect(sanitizedArgs).not.toContain('../..')
    })

    test('should handle working directory not existing', async () => {
      const mockChild = createMockChildProcess({
        error: new Error('ENOENT: no such file or directory'),
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.compilePdfLatex('test.tex', '/nonexistent/dir'),
      ).rejects.toThrow('ENOENT')
    })

    test('should handle pdflatex success but convert command not found', async () => {
      const pdflatexMock = createMockChildProcess({
        stdout: 'PDF created',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        error: new Error('ENOENT: convert not found'),
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      const result = await executor.compilePdfLatex('test.tex', '/tmp/workdir')

      // Should still return success from pdflatex
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('PDF created')
    })

    test('should handle corrupted tex file causing pdflatex crash', async () => {
      const mockChild = createMockChildProcess({
        signal: 'SIGSEGV',
        exitCode: null as any,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.compilePdfLatex('corrupted.tex', '/tmp/workdir'),
      ).rejects.toThrow()
    })

    test('should handle pdflatex producing large log output', async () => {
      const largeOutput = 'x'.repeat(500 * 1024) // 500KB
      const pdflatexMock = createMockChildProcess({
        stdout: largeOutput,
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      const result = await executor.compilePdfLatex('test.tex', '/tmp/workdir')

      expect(result.stdout).toBe(largeOutput)
      expect(result.exitCode).toBe(0)
    })

    test('should handle convert timing out during PNG conversion', async () => {
      jest.useFakeTimers()

      const pdflatexMock = createMockChildProcess({
        stdout: 'PDF created',
        exitCode: 0,
      })
      const convertMock = createMockChildProcess({
        delay: 40000, // 40 seconds
        exitCode: 0,
      })
      mockSpawn
        .mockReturnValueOnce(pdflatexMock)
        .mockReturnValueOnce(convertMock)

      const promise = executor.compilePdfLatex('test.tex', '/tmp/workdir')

      await Promise.resolve()
      jest.runOnlyPendingTimers()
      jest.advanceTimersByTime(30000) // Convert timeout is 30s

      const result = await promise
      // Should return PDF result even though convert timed out
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('PDF created')

      jest.useRealTimers()
    })
  })

  describe('convertImage Integration', () => {
    test('should execute ImageMagick convert with correct arguments', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.convertImage('input.pdf', 'output.png', '/tmp/workdir')

      expect(mockSpawn).toHaveBeenCalledWith(
        'convert',
        expect.arrayContaining([
          'input.pdf',
          '-resize',
          '4000x4000>',
          '-quality',
          '95',
          '-colorspace',
          'sRGB',
          '-depth',
          '8',
          '-define',
          'png:compression-level=6',
          '-define',
          'png:color-type=2',
          'output.png',
        ]),
        expect.any(Object),
      )
    })

    test('should set ImageMagick resource limit environment variables', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.convertImage('input.pdf', 'output.png', '/tmp/workdir')

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.MAGICK_MEMORY_LIMIT).toBe('2GB')
      expect(spawnOptions.env.MAGICK_MAP_LIMIT).toBe('4GB')
      expect(spawnOptions.env.MAGICK_DISK_LIMIT).toBe('8GB')
      expect(spawnOptions.env.MAGICK_TIME_LIMIT).toBe('120')
    })

    test('should use 30 second timeout for convert', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.convertImage('input.pdf', 'output.png', '/tmp/workdir')

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.timeout).toBe(30000)
    })

    test('should sanitize file paths to basename only', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.convertImage(
        '../../etc/passwd',
        '../../../output.png',
        '/tmp/workdir',
      )

      // Should only use basenames, not full paths
      expect(mockSpawn).toHaveBeenCalledWith(
        'convert',
        expect.arrayContaining(['passwd', 'output.png']),
        expect.any(Object),
      )
    })

    test('should handle convert command not found', async () => {
      const mockChild = createMockChildProcess({
        error: new Error('ENOENT: convert not found'),
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.convertImage('input.pdf', 'output.png', '/tmp/workdir'),
      ).rejects.toThrow('ENOENT')
    })

    test('should handle input file not existing', async () => {
      const mockChild = createMockChildProcess({
        stderr: 'convert: unable to open image',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.convertImage('nonexistent.pdf', 'output.png', '/tmp/workdir'),
      ).rejects.toThrow('Command failed with exit code 1')
    })

    test('should handle corrupted input file', async () => {
      const mockChild = createMockChildProcess({
        stderr: 'convert: no decode delegate for this image format',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.convertImage('corrupted.pdf', 'output.png', '/tmp/workdir'),
      ).rejects.toThrow('no decode delegate')
    })

    test('should handle extremely large input file', async () => {
      const mockChild = createMockChildProcess({
        stderr: 'convert: memory allocation failed',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.convertImage('huge.pdf', 'output.png', '/tmp/workdir'),
      ).rejects.toThrow('memory allocation failed')
    })

    test('should handle working directory not writable', async () => {
      const mockChild = createMockChildProcess({
        stderr: 'convert: unable to open file: Permission denied',
        exitCode: 1,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.convertImage('input.pdf', 'output.png', '/readonly/dir'),
      ).rejects.toThrow('Permission denied')
    })

    test('should handle convert timeout', async () => {
      jest.useFakeTimers()

      const mockChild = createMockChildProcess({
        delay: 40000, // 40 seconds
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const promise = executor.convertImage(
        'input.pdf',
        'output.png',
        '/tmp/workdir',
      )

      await Promise.resolve()
      jest.runOnlyPendingTimers()
      jest.advanceTimersByTime(30000)

      await expect(promise).rejects.toThrow('Command timed out after 30000ms')
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')

      jest.useRealTimers()
    })

    test('should handle convert producing large output', async () => {
      const largeOutput = 'x'.repeat(500 * 1024) // 500KB
      const mockChild = createMockChildProcess({
        stdout: largeOutput,
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      const result = await executor.convertImage(
        'input.pdf',
        'output.png',
        '/tmp/workdir',
      )

      expect(result.stdout).toBe(largeOutput)
      expect(result.exitCode).toBe(0)
    })

    test('should handle convert crash with signal', async () => {
      const mockChild = createMockChildProcess({
        signal: 'SIGKILL',
        exitCode: null as any,
      })
      mockSpawn.mockReturnValue(mockChild)

      await expect(
        executor.convertImage('input.pdf', 'output.png', '/tmp/workdir'),
      ).rejects.toThrow()
    })

    test('should enforce ImageMagick resource limits via env vars', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.convertImage('input.pdf', 'output.png', '/tmp/workdir')

      const spawnOptions = mockSpawn.mock.calls[0][2]
      expect(spawnOptions.env.MAGICK_MEMORY_LIMIT).toBe('2GB')
      expect(spawnOptions.env.MAGICK_MAP_LIMIT).toBe('4GB')
      expect(spawnOptions.env.MAGICK_DISK_LIMIT).toBe('8GB')
      expect(spawnOptions.env.MAGICK_TIME_LIMIT).toBe('120')
    })

    test('should handle output file with dangerous characters in name', async () => {
      const mockChild = createMockChildProcess({
        stdout: 'success',
        exitCode: 0,
      })
      mockSpawn.mockReturnValue(mockChild)

      await executor.convertImage(
        'input.pdf',
        'output;whoami.png',
        '/tmp/workdir',
      )

      const sanitizedArgs = mockSpawn.mock.calls[0][1]
      // Dangerous chars should be removed
      const outputArg = sanitizedArgs[sanitizedArgs.length - 1]
      expect(outputArg).not.toContain(';')
    })
  })
})
