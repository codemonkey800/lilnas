import pluginReact from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

import base from './base.js'

export default [
  ...base,

  {
    settings: {
      react: {
        version: 'detect',
      },
    },
  },

  {
    plugins: {
      'react-hooks': reactHooks,
    },

    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat['jsx-runtime'],
]
