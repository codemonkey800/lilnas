# icloud-backup

Backs up each person's iCloud Photos to `/storage/photos/icloud-users` with
[icloudpd](https://github.com/icloud-photos-downloader/icloud_photos_downloader)
and registers the folder as an Immich external library.

NestJS backend (port 8081) plus Next.js frontend (port 8080) in one package.
The frontend proxies `/api/*` and `/ws` to the backend. Identity comes from
Traefik's `X-Forwarded-User` / `X-Forwarded-User-Id` headers; `GET /health` is
the only unguarded route.

## Layout

| Path            | Purpose                                               |
| --------------- | ----------------------------------------------------- |
| `src/shared/`   | Wire contract (zod), imported by backend and frontend |
| `src/auth/`     | Forwarded-user identity and admin guards              |
| `src/db/`       | Drizzle schema, migrations and the database module    |
| `src/icloudpd/` | Running and supervising icloudpd                      |
| `src/immich/`   | Immich API client                                     |
| `src/jobs/`     | Backup job state machine and queue                    |
| `src/api/`      | User-facing HTTP and WebSocket API                    |
| `src/admin/`    | Admin endpoints                                       |
| `scripts/`      | `fetch-icloudpd.sh`, used by the Dockerfile           |

## Running

```bash
pnpm --filter @lilnas/utils build
pnpm --filter @lilnas/ui build
pnpm --filter @lilnas/icloud-backup dev
```

## Environment

See `.env.example` for every key and its default.

## Image

The Dockerfile downloads the pinned icloudpd release (version and sha256 are at
the top of `scripts/fetch-icloudpd.sh`) and fails the build on a checksum
mismatch or if `icloudpd --version` is not the pinned version. To upgrade,
change both variables and the version in the Dockerfile's `grep`.
