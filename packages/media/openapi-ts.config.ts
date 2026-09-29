import { defineConfig } from '@hey-api/openapi-ts'

const radarrInput = './apis/radarr.json'
const sonarrInput = './apis/sonarr.json'

export default defineConfig([
  {
    input: radarrInput,
    output: 'src/radarr',
    plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
  },
  {
    input: sonarrInput,
    output: 'src/sonarr',
    plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
  },
])
