import { defineConfig } from '@hey-api/openapi-ts'

const input = './apis/radarr.json'

export default defineConfig([
  {
    input,
    output: 'src/radarr',
    plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
  },
  {
    input,
    output: 'src/radarr-next',
    plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-next'],
  },
])
