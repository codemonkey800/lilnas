/* eslint-disable @typescript-eslint/no-require-imports */

const { base, react } = require('@lilnas/eslint')

module.exports = [
  ...base,
  ...react,
  {
    rules: {
      // React Three Fiber uses custom properties like 'args', 'attach', 'position', 'intensity'
      'react/no-unknown-property': [
        'error',
        {
          ignore: [
            'args',
            'attach',
            'position',
            'intensity',
            'rotation',
            'scale',
            'color',
          ],
        },
      ],
    },
  },
]
