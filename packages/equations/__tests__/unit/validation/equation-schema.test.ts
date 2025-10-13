import {
  CreateEquationSchema,
  validateLatexSafety,
} from 'src/validation/equation.schema'
import {
  excessiveNesting,
  excessiveRepetition,
  longLines,
  oversizedInputs,
  unbalancedBraces,
} from '__tests__/fixtures/invalid-equations'
import {
  dangerousCommands,
  pathTraversalInputs,
  unauthorizedPackages,
  unicodeAttacks,
} from '__tests__/fixtures/malicious-inputs'
import {
  validComplexEquations,
  validDisplayEquations,
  validEdgeCases,
  validInlineEquations,
  validNesting,
  validSpecialCharacters,
  validWithAllowedPackages,
} from '__tests__/fixtures/valid-equations'

describe('CreateEquationSchema', () => {
  const validToken = 'test-token'

  describe('Valid Equations', () => {
    describe('Inline equations', () => {
      test.each(validInlineEquations)(
        'should accept $description',
        ({ latex }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(true)
        },
      )
    })

    describe('Display equations', () => {
      test.each(validDisplayEquations)(
        'should accept $description',
        ({ latex }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(true)
        },
      )
    })

    describe('Complex equations', () => {
      test.each(validComplexEquations)(
        'should accept $description',
        ({ latex }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(true)
        },
      )
    })

    describe('Allowed packages', () => {
      test.each(validWithAllowedPackages)(
        'should accept $description',
        ({ latex }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(true)
        },
      )
    })

    describe('Special characters', () => {
      test.each(validSpecialCharacters)(
        'should accept $description',
        ({ latex }) => {
          const result = CreateEquationSchema.safeParse({
            token: validToken,
            latex,
          })
          expect(result.success).toBe(true)
        },
      )
    })

    describe('Valid nesting', () => {
      test.each(validNesting)('should accept $description', ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(true)
      })
    })

    describe('Edge cases', () => {
      test.each(validEdgeCases)('should accept $description', ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Security: Blocked LaTeX Commands', () => {
    test.each(dangerousCommands)(
      'should reject $description: $latex',
      ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map(issue => issue.message)
          expect(errorMessages.join(' ')).toMatch(
            /dangerous commands|category code|unsafe/i,
          )
        }
      },
    )
  })

  describe('Security: Path Traversal Prevention', () => {
    test.each(pathTraversalInputs)(
      'should reject $description: $latex',
      ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map(issue => issue.message)
          expect(errorMessages.join(' ')).toMatch(/unsafe path/i)
        }
      },
    )
  })

  describe('Security: Unauthorized Packages', () => {
    test.each(unauthorizedPackages)(
      'should reject $description: $latex',
      ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map(issue => issue.message)
          expect(errorMessages.join(' ')).toMatch(/unauthorized packages/i)
        }
      },
    )
  })

  describe('Security: Unicode and Encoding Attacks', () => {
    test.each(unicodeAttacks)(
      'should reject $description: $latex',
      ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
      },
    )
  })

  describe('Input Size Validation', () => {
    it('should accept input at exactly 2000 characters', () => {
      const latex = 'A'.repeat(2000)
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex,
      })
      expect(result.success).toBe(true)
    })

    it('should accept input just under the limit (1999 characters)', () => {
      const latex = 'A'.repeat(1999)
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex,
      })
      expect(result.success).toBe(true)
    })

    test.each(oversizedInputs)('should reject $description', ({ latex }) => {
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const errorMessages = result.error.issues.map(issue => issue.message)
        expect(errorMessages.join(' ')).toMatch(/too long/i)
      }
    })

    it('should reject empty input', () => {
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex: '',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const errorMessages = result.error.issues.map(issue => issue.message)
        expect(errorMessages.join(' ')).toMatch(/required/i)
      }
    })
  })

  describe('Nesting Depth Validation', () => {
    it('should accept exactly 10 levels of nesting (at limit)', () => {
      const latex = '{'.repeat(10) + 'x' + '}'.repeat(10)
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex,
      })
      expect(result.success).toBe(true)
    })

    it('should accept 9 levels of nesting (under limit)', () => {
      const latex = '{'.repeat(9) + 'x' + '}'.repeat(9)
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex,
      })
      expect(result.success).toBe(true)
    })

    test.each(excessiveNesting)('should reject $description', ({ latex }) => {
      const result = CreateEquationSchema.safeParse({
        token: validToken,
        latex,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const errorMessages = result.error.issues.map(issue => issue.message)
        expect(errorMessages.join(' ')).toMatch(
          /invalid structure|excessive nesting/i,
        )
      }
    })

    test.each(unbalancedBraces)(
      'should reject unbalanced braces: $description',
      ({ latex }) => {
        const result = CreateEquationSchema.safeParse({
          token: validToken,
          latex,
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map(issue => issue.message)
          expect(errorMessages.join(' ')).toMatch(/invalid structure/i)
        }
      },
    )
  })

  describe('Malformed Request Body Handling', () => {
    it('should reject missing token field', () => {
      const result = CreateEquationSchema.safeParse({
        latex: '$x = 1$',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(
          result.error.issues.some(issue => issue.path.includes('token')),
        ).toBe(true)
      }
    })

    it('should reject missing latex field', () => {
      const result = CreateEquationSchema.safeParse({
        token: validToken,
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(
          result.error.issues.some(issue => issue.path.includes('latex')),
        ).toBe(true)
      }
    })

    it('should reject wrong field types', () => {
      const invalidInputs = [
        { token: 123, latex: '$x = 1$' }, // number instead of string
        { token: validToken, latex: 456 }, // number instead of string
        { token: null, latex: '$x = 1$' }, // null token
        { token: validToken, latex: null }, // null latex
        { token: undefined, latex: '$x = 1$' }, // undefined token
        { token: validToken, latex: undefined }, // undefined latex
        { token: ['array'], latex: '$x = 1$' }, // array instead of string
        { token: validToken, latex: { object: true } }, // object instead of string
      ]

      invalidInputs.forEach(input => {
        const result = CreateEquationSchema.safeParse(input)
        expect(result.success).toBe(false)
      })
    })

    it('should reject empty object', () => {
      const result = CreateEquationSchema.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('should reject nested objects in wrong structure', () => {
      const result = CreateEquationSchema.safeParse({
        token: { nested: 'object' },
        latex: { nested: 'object' },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('Token Validation', () => {
    it('should reject empty token', () => {
      const result = CreateEquationSchema.safeParse({
        token: '',
        latex: '$x = 1$',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const errorMessages = result.error.issues.map(issue => issue.message)
        expect(errorMessages.join(' ')).toMatch(/required/i)
      }
    })

    it('should accept any non-empty token string', () => {
      const tokens = [
        'valid-token',
        'another_token',
        'token123',
        'very-long-token-with-many-characters',
        '!@#$%^&*()',
      ]

      tokens.forEach(token => {
        const result = CreateEquationSchema.safeParse({
          token,
          latex: '$x = 1$',
        })
        expect(result.success).toBe(true)
      })
    })
  })
})

describe('validateLatexSafety', () => {
  describe('Excessive Repetition Detection', () => {
    test.each(excessiveRepetition)(
      'should detect $description',
      ({ latex }) => {
        const result = validateLatexSafety(latex)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Excessive repetition detected')
      },
    )

    it('should allow reasonable repetition', () => {
      const latex = 'abc'.repeat(5) // Only 5 times
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject patterns repeated 11 or more times', () => {
      // The regex /(.{3,})\1{10,}/ matches a pattern of 3+ characters
      // repeated 10 or more times after the first occurrence (11+ total)
      const latex = '123'.repeat(11) // Pattern appears 11 times total - should be rejected
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Excessive repetition detected')
    })

    it('should allow pattern repeated exactly 10 times', () => {
      // Only 10 total occurrences = 1 original + 9 repeats, doesn't trigger \1{10,}
      const latex = '123'.repeat(10)
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle overlapping patterns correctly', () => {
      // 10-char pattern repeated 11 times = 110 chars total
      // Tests that longer patterns are detected correctly
      const latex = '0123456789'.repeat(11)
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Excessive repetition detected')
    })
  })

  describe('Long Line Detection', () => {
    test.each(longLines)('should detect $description', ({ latex }) => {
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(
        'Line too long (max 200 characters per line)',
      )
    })

    it('should reject lines at exactly 201 characters', () => {
      // The validation checks `line.length > 200`, so 201 is rejected
      const latex = 'A'.repeat(201)
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(
        'Line too long (max 200 characters per line)',
      )
    })

    it('should allow lines at exactly 200 characters', () => {
      // Create 200 characters with varied content - no repeating 3+ char patterns 11+ times
      const latex = 'abcdefghij'.repeat(10) + 'ABCDEFGHIJ'.repeat(10) // Two different 10-char patterns, each repeated 10 times
      expect(latex.length).toBe(200)
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should allow lines under 200 characters without repetition', () => {
      // Lines under 200 characters should pass, as long as there's no repetition
      // Create a string with varied characters to avoid triggering repetition detection
      const latex =
        '$x = 1$ and $y = 2$ and $z = 3$ some more varied text here to make it longer without repeating patterns that would trigger the DoS check which looks for patterns'
      expect(latex.length).toBeLessThan(200)
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should check all lines in multi-line input', () => {
      const latex = 'Short\n' + 'A'.repeat(300) + '\nShort again'
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(
        'Line too long (max 200 characters per line)',
      )
    })

    it('should allow multiple short lines', () => {
      const latex = 'Short\nAnother short line\nYet another\n'
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Combined Validation', () => {
    it('should return multiple errors when multiple issues exist', () => {
      const latex = 'abc'.repeat(50) + '\n' + 'X'.repeat(250)
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
      expect(result.errors).toContain('Excessive repetition detected')
      expect(result.errors).toContain(
        'Line too long (max 200 characters per line)',
      )
    })

    it('should pass valid input with no issues', () => {
      const latex = '$x = 1$ and $y = 2$ are simple equations'
      const result = validateLatexSafety(latex)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })
})
