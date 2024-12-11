/* eslint-disable @typescript-eslint/no-require-imports */

const pluginJs = require('@eslint/js')
const eslintConfigPrettier = require('eslint-config-prettier')
const importPlugin = require('eslint-plugin-import')
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended')
const simpleImportSort = require('eslint-plugin-simple-import-sort')
const unusedImports = require('eslint-plugin-unused-imports')
const globals = require('globals')
const tseslint = require('typescript-eslint')
const noRelativeImports = require('eslint-plugin-no-relative-import-paths')

module.exports = [
  {
    files: ['**/*.{js,mjs,cjs,ts}'],

    languageOptions: {
      ecmaVersion: 2020,

      globals:  globals.node
    },
  },

  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },

      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: '.',
        },
      },
    },
  },

  eslintConfigPrettier,
  eslintPluginPrettierRecommended,
  importPlugin.flatConfigs.recommended,

  // Plugins
  {
    plugins: {
      'no-relative-import-paths': noRelativeImports,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },

    rules: {
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Side effect imports.
            ['^\\u0000'],
            // Node.js builtins prefixed with `node:`.
            ['^node:'],
            // Packages.
            // Things that start with a letter (or digit or underscore), or `@` followed by a letter.
            ['^@?\\w'],
            // src imports
            ['^src'],
            // Absolute imports and other imports such as Vue-style `@/foo`.
            // Anything not matched in another group.
            ['^'],
            // Relative imports.
            // Anything that starts with a dot.
            ['^\\.'],
          ],
        },
      ],

      'import/no-unresolved': 'off',
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      'no-relative-import-paths/no-relative-import-paths': [
        'error',
        { allowSameFolder: true, rootDir: 'src', prefix: 'src' },
      ],
    },
  },
]
