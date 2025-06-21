import { z } from 'zod'

// Dangerous LaTeX commands that can execute arbitrary code or access files
const DANGEROUS_COMMANDS_REGEX =
  /\\(write18|immediate|input|include|InputIfFileExists|openout|closeout|system|ShellEscape|read|openin|catcode|def|gdef|edef|xdef|let|futurelet|expandafter|csname|endcsname|string|meaning|jobname|detokenize|scantokens)/i

// File system and path-related patterns that could be exploited
const PATH_TRAVERSAL_REGEX =
  /\.\.|\/\.\.|~|\/etc\/|\/proc\/|\/sys\/|\/dev\/|\/tmp\/|\\string|\\detokenize/i

// Only allow basic math packages
const ALLOWED_PACKAGES = [
  'amsmath',
  'amssymb',
  'amsfonts',
  'mathtools',
  'geometry',
  'xcolor',
  'graphicx',
]

// Validate package imports
const validatePackages = (latex: string): boolean => {
  const packageMatches = latex.match(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)
  if (!packageMatches) return true

  return packageMatches.every(match => {
    const packageName = match.match(/\{([^}]+)\}/)?.[1]
    return packageName && ALLOWED_PACKAGES.includes(packageName)
  })
}

// Maximum nesting depth to prevent infinite loops
const validateNestingDepth = (latex: string): boolean => {
  let depth = 0
  let maxDepth = 0

  for (const char of latex) {
    if (char === '{') {
      depth++
      maxDepth = Math.max(maxDepth, depth)
    } else if (char === '}') {
      depth--
    }

    if (maxDepth > 10) return false // Max 10 levels of nesting
  }

  return depth === 0 // Ensure balanced braces
}

export const CreateEquationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  latex: z
    .string()
    .min(1, 'LaTeX content is required')
    .max(2000, 'LaTeX content too long (max 2000 characters)')
    .refine((latex: string) => !DANGEROUS_COMMANDS_REGEX.test(latex), {
      message: 'LaTeX contains potentially dangerous commands',
    })
    .refine((latex: string) => !PATH_TRAVERSAL_REGEX.test(latex), {
      message: 'LaTeX contains potentially unsafe path references',
    })
    .refine(validatePackages, {
      message: 'LaTeX contains unauthorized packages',
    })
    .refine(validateNestingDepth, {
      message: 'LaTeX has invalid structure or excessive nesting',
    })
    // Additional safety checks
    .refine((latex: string) => !latex.includes('\\catcode'), {
      message: 'Category code changes not allowed',
    }),
})

export type CreateEquationDto = z.infer<typeof CreateEquationSchema>

// Additional runtime validation helper
export const validateLatexSafety = (
  latex: string,
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []

  // Check for excessive repetition (potential DoS)
  const repeatedPatterns = latex.match(/(.{3,})\1{10,}/g)
  if (repeatedPatterns) {
    errors.push('Excessive repetition detected')
  }

  // Check for very long lines (potential memory issues)
  const lines = latex.split('\n')
  if (lines.some(line => line.length > 200)) {
    errors.push('Line too long (max 200 characters per line)')
  }

  // Check for too many mathematical expressions
  const mathEnvironments = (
    latex.match(/\$|\\\[|\\\(|\\begin\{(equation|align|gather|multline)\}/g) ||
    []
  ).length
  if (mathEnvironments > 20) {
    errors.push('Too many mathematical expressions (max 20)')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
