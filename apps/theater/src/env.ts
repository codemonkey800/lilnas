export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT',
  EMBY_API_KEY: 'EMBY_API_KEY',
  EMBY_URL: 'EMBY_URL',
  EMBY_USERNAME: 'EMBY_USERNAME',
  // Read by the presence gateway to compute its dev-only CORS origin
  // (presence.gateway.ts) — the frontend itself already reads this via
  // shell interpolation in package.json's `dev:frontend` script, not `env()`.
  FRONTEND_PORT: 'FRONTEND_PORT',
  NODE_ENV: 'NODE_ENV',
  THEATER_PASSWORD: 'THEATER_PASSWORD',
  THEATER_SESSION_SECRET: 'THEATER_SESSION_SECRET',
} as const
