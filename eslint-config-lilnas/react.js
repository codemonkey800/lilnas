const pluginReact = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')

module.exports = [
  // React
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat['jsx-runtime'],
  { settings: { react: { version: 'detect' } } },

  // Plugins
  {
    plugins: {
      'react-hooks': reactHooks,
    },

    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
]
