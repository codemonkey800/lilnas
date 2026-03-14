# @lilnas/yoink

Web app for managing movie and show downloads through the lilnas Radarr and Sonarr APIs.

## Features

### Login

- Google sign-in page — the only way to authenticate
- After sign-in, the user is routed based on their account status:
  - **Pending** — first-time sign-in; shows a waiting page explaining that an
    admin needs to approve their account before they can continue
  - **Denied** — admin rejected the request; shows a denied page with the
    option to re-request access, which moves them back to pending
  - **Approved** — full access; redirects to search (home)

### Admin

- Only accessible to admin users (designated via `ADMIN_EMAIL` env var)
- **Pending requests** — list of users awaiting approval, showing name, email,
  avatar, and when they signed up; each entry has approve and deny actions
- **Approved users** — list of all users with active access
- Approving a request grants the user immediate access on their next page load
- Denying a request removes it from the pending list; the user sees a denied
  state with the option to re-request

### Search (Home)

- Landing page at `/` — the first thing users see after login
- Search for movies and shows across Radarr/Sonarr in one view
- Pick a result to jump to its details page
- Filter toggle for movies, shows, or both (both by default)

### Library

- Read-only view of all movies and shows that have already been downloaded
  at `/library`
- Toggle to show only movies or shows, default is both
- Click into any title to see more details
- Empty state graphic if nothing is downloaded yet

### Movie Details

- All metadata for the movie
- Lists every file for the movie
- If the movie is currently downloading, show a progress bar with ETA, speed,
  and size info inline on the page
- Actions:
  - Download if not already downloaded
  - Delete if already downloaded
  - Re-download a different file, overwriting the old one

### Show Details

- All metadata for the show
- Season cards with episode items inside each card
- Episodes that are currently downloading show a progress bar with ETA, speed,
  and size info inline on the episode item
- Actions:
  - Download or delete at the series, season, or episode level
  - Re-download a different episode, overwriting the old one

### Downloads

- Live view of all active and queued downloads across Radarr and Sonarr
- Each item shows title, progress bar, speed, size, and ETA
- Items are grouped: actively downloading first, then queued
- Click any item to jump to its movie or show details page
- Failed downloads surface with the error reason and a retry action
- Empty state when nothing is downloading

### History

- Reverse-chronological feed of completed events (grabs, imports, upgrades,
  deletions, failures)
- Each entry shows the title, event type, quality, and timestamp
- Click any entry to jump to its movie or show details page
- Filter by event type (grabbed, imported, upgraded, deleted, failed)
- Filter toggle for movies, shows, or both (both by default)
- Paginated — loads more entries on scroll

### Storage

- Overview of total, used, and free disk space for each root folder
- Visual bar showing used vs. free per root folder
- Breakdown of space by library (movies vs. shows)
- List of the largest items by file size for quick cleanup
- Warning indicator when free space drops below a configurable threshold

## Tech Stack

| Layer      | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Framework  | Next.js 16 (standalone output, Turbopack dev)         |
| Auth       | NextAuth v5 beta (Google OAuth) with Drizzle adapter  |
| Database   | PostgreSQL 17 via Drizzle ORM                         |
| UI         | Tailwind CSS v4, Material UI (MUI), MUI Icons          |
| Design     | "Phosphor Terminal" CRT-inspired dark theme           |
| Typography | JetBrains Mono (headings/data) + Space Grotesk (body) |

See [`DESIGN.md`](DESIGN.md) for the full design system.

## Development

`pnpm run dev` spins up a disposable Postgres container, pushes the Drizzle
schema, and starts the Next.js dev server on port 8080. The container is torn
down on exit.

```bash
pnpm run dev
```

### Database Commands

```bash
pnpm run db:studio     # Open Drizzle Studio to inspect the database
pnpm run db:generate   # Generate migration files from schema changes
pnpm run db:migrate    # Run pending migrations
pnpm run db:push       # Push schema directly (dev only)
```

### Code Quality

```bash
pnpm run lint          # Run ESLint + Prettier checks
pnpm run lint:fix      # Auto-fix lint issues
pnpm run type-check    # TypeScript type checking
```

## Environment Variables

See [`infra/.env.yoink.example`](../../infra/.env.yoink.example) for a full
template.

| Variable             | Description                  | Required in Dev |
| -------------------- | ---------------------------- | --------------- |
| `DATABASE_URL`       | PostgreSQL connection string | No (auto)       |
| `POSTGRES_DB`        | Database name                | No (auto)       |
| `POSTGRES_USER`      | Database user                | No (auto)       |
| `POSTGRES_PASSWORD`  | Database password            | No (auto)       |
| `AUTH_SECRET`        | NextAuth secret key          | Yes             |
| `AUTH_GOOGLE_ID`     | Google OAuth client ID       | Yes             |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret   | Yes             |
| `ADMIN_EMAIL`        | Email of the admin user      | Yes             |

The dev script sets up all database variables automatically. You only need the
`AUTH_*` variables if you want Google OAuth working locally.

## Deployment

**Production** at `yoink.lilnas.io` via Traefik with SSL and forward-auth
middleware. Multi-stage Dockerfile on top of the monorepo base images.

**Development** at `yoink.localhost` via Docker Compose.

```bash
# Production
docker-compose -f deploy.yml up -d

# Development
docker-compose -f deploy.dev.yml up -d
```
