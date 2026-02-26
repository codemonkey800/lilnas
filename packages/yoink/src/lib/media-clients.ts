import { createClient as createRadarrClient } from '@lilnas/media/radarr/client'
import { createClient as createSonarrClient } from '@lilnas/media/sonarr/client'

export function getRadarrClient() {
  return createRadarrClient({
    baseUrl: process.env.RADARR_URL!,
    headers: { 'X-Api-Key': process.env.RADARR_API_KEY! },
  })
}

export function getSonarrClient() {
  return createSonarrClient({
    baseUrl: process.env.SONARR_URL!,
    headers: { 'X-Api-Key': process.env.SONARR_API_KEY! },
  })
}
