export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT',
  NODE_ENV: 'NODE_ENV',
  JWT_SECRET: 'JWT_SECRET',
  JWT_EXPIRATION: 'JWT_EXPIRATION',
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET',
  GOOGLE_CALLBACK_URL: 'GOOGLE_CALLBACK_URL',
  ADMIN_EMAIL: 'ADMIN_EMAIL',
  AGENT_API_KEY: 'AGENT_API_KEY',
  DATABASE_URL: 'DATABASE_URL',
  RADARR_URL: 'RADARR_URL',
  RADARR_API_KEY: 'RADARR_API_KEY',
  SONARR_URL: 'SONARR_URL',
  SONARR_API_KEY: 'SONARR_API_KEY',
} as const

const REQUIRED_KEYS = [
  EnvKeys.JWT_SECRET,
  EnvKeys.GOOGLE_CLIENT_ID,
  EnvKeys.GOOGLE_CLIENT_SECRET,
  EnvKeys.GOOGLE_CALLBACK_URL,
  EnvKeys.DATABASE_URL,
  EnvKeys.RADARR_URL,
  EnvKeys.RADARR_API_KEY,
  EnvKeys.SONARR_URL,
  EnvKeys.SONARR_API_KEY,
] as const

/** Validates that all required environment variables are set. Throws on first missing value. */
export function validateEnv(): void {
  const missing = REQUIRED_KEYS.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    )
  }
}
