const { RuleTester } = require('eslint')
const { describe, it } = require('node:test')

const rule = require('./no-raw-palette')

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const bad = code => ({ code, errors: [{ messageId: 'raw' }] })

tester.run('no-raw-palette', rule, {
  valid: [
    `const a = 'bg-surface text-ink-2 border-line'`,
    `const a = 'text-accent-hi hover:bg-accent-ghost ease-standard'`,
    `const a = 'text-h1 text-label ring-2 shadow-lg bg-gray'`,
    `const a = <div className="bg-bad-ghost text-bad" />`,
    `const a = \`bg-\${tone}-500\``,
    `const a = '#9b7bf5'`,
    `const a = 'the guy-uv-sky text-grayish-400'`,
    `// bg-gray-800 in a comment is fine`,
  ],

  invalid: [
    bad(`const a = 'bg-gray-800'`),
    bad(`const a = 'flex text-blue-400 hover:underline'`),
    bad(`const a = 'hover:border-zinc-700'`),
    bad(`const a = 'md:!text-violet-300/50'`),
    bad(`const a = 'from-purple-500 to-pink-500'`),
    bad(`const a = 'border-t-red-500'`),
    bad(`const a = <p className="text-gray-400">x</p>`),
    bad(`const a = <p className={cn('mt-4', 'text-neutral-500')}>x</p>`),
    bad(`const a = \`flex bg-slate-900 \${x}\``),
    bad(`const a = 'bg-uv text-accent'`),
    bad(`const a = 'hover:bg-uv-hi'`),
    bad(`const a = 'transition ease-uv'`),
    bad(`const a = 'border-uv/40'`),
    bad(`const a = 'var(--color-uv-ink)'`),
  ],
})
