/**
 * Valid LaTeX equation inputs for testing
 *
 * These inputs should all PASS validation.
 * Organized by category for comprehensive coverage:
 * - Inline and display equations
 * - Complex mathematical expressions
 * - Allowed packages (amsmath, amssymb, etc.)
 * - Special characters and symbols
 * - Valid nesting within limits
 * - Edge cases at boundaries
 */

export const validInlineEquations = [
  { latex: '$x = 1$', description: 'Simple inline equation' },
  { latex: '$y = 2x + 3$', description: 'Linear equation' },
  { latex: '$a^2 + b^2 = c^2$', description: 'Pythagorean theorem' },
  { latex: '$\\sqrt{2}$', description: 'Square root' },
  { latex: '$\\frac{1}{2}$', description: 'Simple fraction' },
  { latex: '$e^{i\\pi} + 1 = 0$', description: "Euler's identity" },
]

export const validDisplayEquations = [
  { latex: '$$x = 1$$', description: 'Simple display equation' },
  { latex: '$$\\int_0^1 x^2 dx$$', description: 'Definite integral' },
  { latex: '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$', description: 'Summation formula' },
  { latex: '$$\\lim_{x \\to \\infty} \\frac{1}{x} = 0$$', description: 'Limit' },
  { latex: '$$\\prod_{i=1}^{n} x_i$$', description: 'Product notation' },
]

export const validComplexEquations = [
  {
    latex: '$$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
    description: 'Quadratic formula',
  },
  {
    latex: '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$',
    description: '2x2 matrix',
  },
  {
    latex: '$$\\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t}$$',
    description: "Faraday's law",
  },
  {
    latex: '$$\\oint_C \\vec{F} \\cdot d\\vec{r} = \\iint_S (\\nabla \\times \\vec{F}) \\cdot d\\vec{S}$$',
    description: "Stokes' theorem",
  },
  {
    latex: '$$\\mathbb{E}[X] = \\sum_{i} x_i p(x_i)$$',
    description: 'Expected value',
  },
]

export const validWithAllowedPackages = [
  {
    latex: '\\usepackage{amsmath}\n$$x = 1$$',
    description: 'AMS math package',
  },
  {
    latex: '\\usepackage{amssymb}\n$$\\mathbb{R}$$',
    description: 'AMS symbols package',
  },
  {
    latex: '\\usepackage{amsfonts}\n$$\\mathfrak{A}$$',
    description: 'AMS fonts package',
  },
  {
    latex: '\\usepackage{mathtools}\n$$x := y$$',
    description: 'Math tools package',
  },
  {
    latex: '\\usepackage{geometry}\n$$x = 1$$',
    description: 'Geometry package',
  },
  {
    latex: '\\usepackage{xcolor}\n$$\\textcolor{red}{x = 1}$$',
    description: 'XColor package',
  },
  {
    latex: '\\usepackage{graphicx}\n$$x = 1$$',
    description: 'Graphics package',
  },
  {
    latex: '\\usepackage{amsmath}\\usepackage{amssymb}\n$$x \\in \\mathbb{R}$$',
    description: 'Multiple allowed packages',
  },
]

export const validSpecialCharacters = [
  { latex: '$$\\alpha, \\beta, \\gamma, \\delta$$', description: 'Greek letters' },
  { latex: '$$\\forall x \\exists y$$', description: 'Quantifiers' },
  { latex: '$$A \\cup B \\cap C$$', description: 'Set operations' },
  { latex: '$$x \\in X, y \\notin Y$$', description: 'Set membership' },
  { latex: '$$\\infty, \\partial, \\nabla$$', description: 'Special math symbols' },
  { latex: '$$\\leq, \\geq, \\neq, \\approx$$', description: 'Comparison operators' },
  { latex: '$$\\leftarrow, \\rightarrow, \\Leftrightarrow$$', description: 'Arrows' },
]

export const validNesting = [
  { latex: '$$\\frac{\\frac{a}{b}}{\\frac{c}{d}}$$', description: 'Nested fractions (3 levels)' },
  {
    latex: '$$\\sqrt{\\sqrt{\\sqrt{x}}}$$',
    description: 'Nested square roots (4 levels)',
  },
  {
    latex: '$$\\left(\\left(\\left(x\\right)\\right)\\right)$$',
    description: 'Nested parentheses (4 levels)',
  },
  {
    latex: '$${{{{{{{{{x}}}}}}}}}$$',
    description: 'Nested braces (10 levels - at limit)',
  },
]

export const validEdgeCases = [
  { latex: '$x$', description: 'Minimal valid equation' },
  { latex: '$$$$', description: 'Empty display equation' },
  { latex: '${}$', description: 'Empty braces' },
  { latex: '$\\text{Hello World}$', description: 'Text in equation' },
  { latex: '$x_1, x_2, \\ldots, x_n$', description: 'Subscripts and ellipsis' },
  { latex: '$x^{y^z}$', description: 'Nested superscripts' },
  {
    latex: 'A' + ' '.repeat(1990) + 'B',
    description: 'Near max length (1992 chars)',
  },
]
