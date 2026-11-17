const noRawPalette = require('./rules/no-raw-palette')

/**
 * Design-system guard. Add to an app's flat config *after* `base`/`react`:
 * `[...base, ...react, ...designSystem]`. Do not add it to `packages/ui`,
 * the one place a palette value may live (in `theme.css`).
 */
module.exports = [
  {
    files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'],

    plugins: {
      'lilnas-design': {
        rules: { 'no-raw-palette': noRawPalette },
      },
    },

    rules: {
      'lilnas-design/no-raw-palette': 'error',
    },
  },
]
