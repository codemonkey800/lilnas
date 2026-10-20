const { fixupPluginRules } = require('@eslint/compat')
const pluginReact = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')

// eslint-plugin-react@7.37.5 still calls context.getFilename() and friends,
// which ESLint 10 removed. fixupPluginRules shims the legacy context API.
// Drop the wrapper once the plugin ships ESLint 10 support.
const reactPlugin = fixupPluginRules(pluginReact)

module.exports = [
  // React
  {
    ...pluginReact.configs.flat.recommended,
    plugins: { react: reactPlugin },
  },
  {
    ...pluginReact.configs.flat['jsx-runtime'],
    plugins: { react: reactPlugin },
  },
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
