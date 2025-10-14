/**
 * Invalid LaTeX equation inputs for structural/size validation testing
 *
 * These inputs should all FAIL validation due to:
 * - Excessive size (>2000 characters)
 * - Excessive nesting (>10 levels)
 * - Unbalanced braces
 * - Excessive repetition (DoS prevention)
 * - Lines too long (>200 characters)
 * - Empty or invalid structure
 *
 * Note: These are non-security validation failures.
 * For security-focused tests, see malicious-inputs.ts
 */

export const oversizedInputs = [
  {
    latex: 'A'.repeat(2001),
    description: 'Exactly 2001 characters (1 over limit)',
  },
  {
    latex: 'A'.repeat(3000),
    description: '3000 characters',
  },
  {
    latex: 'A'.repeat(10000),
    description: '10000 characters',
  },
  {
    latex: '$' + 'x'.repeat(2000) + '$',
    description: 'Valid structure but oversized',
  },
]

export const excessiveNesting = [
  {
    latex: '{'.repeat(11) + 'x' + '}'.repeat(11),
    description: '11 levels of nesting (1 over limit)',
  },
  {
    latex: '{'.repeat(20) + 'x' + '}'.repeat(20),
    description: '20 levels of nesting',
  },
  {
    latex: '{'.repeat(50) + 'x' + '}'.repeat(50),
    description: '50 levels of nesting',
  },
  {
    latex: '$$' + '\\frac{'.repeat(11) + 'x' + '}'.repeat(11) + '$$',
    description: 'Nested fractions (11 levels)',
  },
]

export const unbalancedBraces = [
  { latex: '{x', description: 'Opening brace without closing' },
  { latex: 'x}', description: 'Closing brace without opening' },
  { latex: '{{x}', description: 'More opening than closing' },
  { latex: '{x}}', description: 'More closing than opening' },
  { latex: '$$\\frac{a}{b$$', description: 'Unbalanced in fraction' },
  { latex: '{{{x}', description: 'Multiple unbalanced opening' },
  { latex: 'x}}}', description: 'Multiple unbalanced closing' },
]

export const excessiveRepetition = [
  {
    latex: 'abc'.repeat(50),
    description: 'Pattern repeated 50 times (triggers DoS check)',
  },
  {
    latex: '123'.repeat(100),
    description: 'Pattern repeated 100 times',
  },
  {
    latex: '$x=1$'.repeat(30),
    description: 'Equation repeated 30 times',
  },
  {
    latex: '\\frac{1}{2}'.repeat(20),
    description: 'Command repeated 20 times',
  },
]

export const longLines = [
  {
    latex: 'A'.repeat(201),
    description: 'Single line with 201 characters (1 over limit)',
  },
  {
    latex: 'x=1+2+3+' + '4+'.repeat(100),
    description: 'Very long equation line',
  },
  {
    latex: '$x = ' + '1234567890'.repeat(25) + '$',
    description: 'Long line within equation',
  },
  {
    latex: 'Short\n' + 'A'.repeat(300) + '\nShort',
    description: 'One line exceeds limit in multi-line input',
  },
]

export const emptyOrInvalidStructure = [
  { latex: '', description: 'Empty string' },
  { latex: '   ', description: 'Whitespace only' },
  { latex: '\n\n\n', description: 'Newlines only' },
  { latex: '\t\t\t', description: 'Tabs only' },
]
