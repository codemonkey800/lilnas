export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT', // default 8081
  NODE_ENV: 'NODE_ENV',

  POSTGRES_HOST: 'POSTGRES_HOST',
  POSTGRES_PORT: 'POSTGRES_PORT',
  POSTGRES_USER: 'POSTGRES_USER',
  POSTGRES_PASSWORD: 'POSTGRES_PASSWORD',
  POSTGRES_DB: 'POSTGRES_DB',

  ICLOUDPD_BIN: 'ICLOUDPD_BIN', // default /usr/local/bin/icloudpd
  ICLOUDPD_WEBUI_URL: 'ICLOUDPD_WEBUI_URL', // default http://127.0.0.1:8080
  // Optional int; adds `--recent N` to icloudpd. Dry runs only.
  ICLOUDPD_RECENT: 'ICLOUDPD_RECENT',

  // Where each person's photos land (host /storage/photos-archive/icloud-users).
  PHOTOS_ROOT: 'PHOTOS_ROOT', // default /photos
  // icloudpd session cookies live under <STATE_ROOT>/cookies/<slug>.
  STATE_ROOT: 'STATE_ROOT', // default /state
  MIN_FREE_BYTES: 'MIN_FREE_BYTES', // default 200000000000
  MAX_DOWNLOADS: 'MAX_DOWNLOADS', // default 2

  IMMICH_URL: 'IMMICH_URL', // default http://immich:2283
  IMMICH_API_KEY: 'IMMICH_API_KEY',
  // Public origin handed to a browser (https://immich.lilnas.io). IMMICH_URL
  // is the container-to-container address and is not reachable from a browser.
  IMMICH_EXTERNAL_URL: 'IMMICH_EXTERNAL_URL', // default https://immich.lilnas.io
  // PHOTOS_ROOT as Immich sees it.
  IMMICH_IMPORT_ROOT: 'IMMICH_IMPORT_ROOT', // default /icloud-users
  // Optional: a@b.c becomes a+<tag>@b.c. Dry runs only.
  IMMICH_EMAIL_PLUS_TAG: 'IMMICH_EMAIL_PLUS_TAG',
  // Optional: prefixes the folder name. Dry runs only.
  ACCOUNT_SLUG_PREFIX: 'ACCOUNT_SLUG_PREFIX',

  // Dev-only fallback identity: see auth/forwarded-user.ts. Never set in
  // production.
  DEV_USER_EMAIL: 'DEV_USER_EMAIL',
  DEV_USER_ID: 'DEV_USER_ID',
} as const
