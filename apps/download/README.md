# download

Video/movie/show download service — yt-dlp for arbitrary video links, Radarr for
movies, Sonarr for shows — with a web UI and API. Spec: `docs/features/download/spec.md`.
Frontend build-out: `docs/features/download/plans/013-frontend-rewrite.md`.

## Running it

```bash
# From the repo root
docker-compose -f docker-compose.dev.yml up -d download-dev

# Or natively, from this directory
pnpm run dev              # backend (NestJS, :8081) + frontend (Next.js, :8080)
pnpm run dev:backend
pnpm run dev:frontend
```

Dev URL: `https://download.localhost` (via Traefik) or the container's published
port directly.

## Route map

| Route | Page |
| --- | --- |
| `/` | Home — library overview, quick-access entry points, recently added |
| `/gallery` | Unified, filterable grid across videos, movies and shows |
| `/search` | Movie and show discovery (Radarr/Sonarr) |
| `/activity` | Every download in flight, across all users, live |
| `/videos/[videoId]` | Video detail — player, progress, pause/cancel/retry, delete, save-to-device |
| `/movies/[tmdbId]` | Movie detail — release picker, grab/replace/report, delete |
| `/shows/[tvdbId]` | Show detail — seasons/episodes, per-episode/season/series download |
| `/profile` | Your download history and stats; `?user=<email>` for another user (admin-only) |
| `/admin` | Admin dashboard — stats, full cross-user history, audit log |

Every route is server-rendered per-request (`headers()` in the root layout makes
the whole app dynamic — correct for a per-user authenticated app).

## Tests

```bash
pnpm test          # jest — node + jsdom projects
pnpm test:watch
pnpm run type-check
pnpm run lint
```
