import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './apis/muapi.json',
  output: 'src/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
})
