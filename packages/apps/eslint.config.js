import eslintConfig from 'eslint-config-lilnas/react'

export default [
  { ignores: ['**/.next/**'] },
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },

  ...eslintConfig,
]
