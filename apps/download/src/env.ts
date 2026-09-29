export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT',
  DATABASE_PATH: 'DATABASE_PATH',
  // Quality tier a movie/show request gets when it names none - one of
  // up_to_4k, hd, up_to_720p. Read via defaultQualityTier(); an unknown
  // value falls back to hd.
  DEFAULT_QUALITY_TIER: 'DEFAULT_QUALITY_TIER',
  // Dev-only fallback identity — see forwarded-user.ts's
  // resolveForwardedUser(). Never set in production (.env.prod on the
  // deploy host has no reason to define these).
  DEV_USER_EMAIL: 'DEV_USER_EMAIL',
  DEV_USER_ID: 'DEV_USER_ID',
  DOWNLOAD_POLL_DURATION_MS: 'DOWNLOAD_POLL_DURATION_MS',
  DOWNLOAD_POLL_RETRIES: 'DOWNLOAD_POLL_RETRIES',
  EMBY_API_KEY: 'EMBY_API_KEY',
  // Public origin used to build watchUrl values handed to a browser
  // (https://emby.lilnas.io). EMBY_URL is the container-to-container
  // address used for API calls and is not reachable from a browser.
  EMBY_EXTERNAL_URL: 'EMBY_EXTERNAL_URL',
  EMBY_URL: 'EMBY_URL',
  EMBY_USERNAME: 'EMBY_USERNAME',
  LOG_FILE_PATH: 'LOG_FILE_PATH',
  MAX_DOWNLOADS: 'MAX_DOWNLOADS',
  MINIO_ACCESS_KEY: 'MINIO_ACCESS_KEY',
  MINIO_HOST: 'MINIO_HOST',
  MINIO_PORT: 'MINIO_PORT',
  MINIO_PUBLIC_URL: 'MINIO_PUBLIC_URL',
  MINIO_SECRET_KEY: 'MINIO_SECRET_KEY',
  NODE_ENV: 'NODE_ENV',
  RADARR_API_KEY: 'RADARR_API_KEY',
  RADARR_URL: 'RADARR_URL',
  // Optional: with either unset, live SABnzbd progress is off and the app
  // behaves as without it. SABNZBD_API_KEY must be SAB's FULL API key - the
  // NZB key only covers level-1 modes, and queue/history need the full one.
  // The full key is SAB admin, which is why SabnzbdService is read-only.
  SABNZBD_API_KEY: 'SABNZBD_API_KEY',
  SABNZBD_URL: 'SABNZBD_URL',
  SONARR_API_KEY: 'SONARR_API_KEY',
  SONARR_URL: 'SONARR_URL',
  YTDLP_AUTO_UPDATE_ENABLED: 'YTDLP_AUTO_UPDATE_ENABLED',
  YTDLP_UPDATE_CRON: 'YTDLP_UPDATE_CRON',
  YTDLP_UPDATE_MAX_RETRIES: 'YTDLP_UPDATE_MAX_RETRIES',
  YTDLP_UPDATE_RETRY_INTERVAL: 'YTDLP_UPDATE_RETRY_INTERVAL',
} as const
