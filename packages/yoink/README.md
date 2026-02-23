# @lilnas/yoink

Web app for managing movie and show downloads through the lilnas Radarr and Sonarr APIs.

## Features

### Dashboard

- Shows all downloaded movies and shows with metadata
- Toggle to show only movies or shows, default is both
- Click into any title to see more details
- Empty state graphic if nothing is downloaded

### Search

- Search for movies and shows across Radarr/Sonarr in one view
- Pick a result to jump to its details page
- Filter toggle for movies, shows, or both (both by default)

### Movie Details

- All metadata for the movie
- Lists every file for the movie
- Actions:
  - Download if not already downloaded
  - Delete if already downloaded
  - Re-download a different file, overwriting the old one

### Show Details

- All metadata for the show
- Season cards with episode items inside each card
- Actions:
  - Download or delete at the series, season, or episode level
  - Re-download a different episode, overwriting the old one

## Tech Stack

| Layer      | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Framework  | Next.js 16 (standalone output, Turbopack dev)         |
| Auth       | NextAuth v5 beta (Google OAuth) with Drizzle adapter  |
| Database   | PostgreSQL 17 via Drizzle ORM                         |
| UI         | Tailwind CSS v4, Radix UI, CVA, Lucide icons          |
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
