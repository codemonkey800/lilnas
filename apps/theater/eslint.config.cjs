/* eslint-disable @typescript-eslint/no-require-imports */

const { base, react } = require('@lilnas/eslint')

module.exports = [
  ...base,
  ...react,
  {
    // react-three-fiber's JSX intrinsics (mesh, planeGeometry, ...) use
    // Three.js-specific props (args, rotation-x, intensity, ...) that
    // eslint-plugin-react's DOM-oriented no-unknown-property rule doesn't
    // recognize.
    files: ['src/components/Scene/**/*.tsx'],
    rules: {
      'react/no-unknown-property': 'off',
    },
  },
]
