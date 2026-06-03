# @lilnas/swole

Workout tracking app. Create routines, run sessions, log sets in real time, and track weight progression over time.

Single Next.js process — server components for reads, server actions for writes, SQLite via Drizzle ORM. No separate backend. See [docs/adr/001-data-flow.md](docs/adr/001-data-flow.md) for why.

## Features

- **Routines** — create and manage named workout routines with per-day scheduling and exercise lists
- **Session runner** — real-time workout tracking driven by a pure FSM ([`src/core/session-machine.ts`](src/core/session-machine.ts)); supports weighted, bodyweight, time-based, and cardio exercise types
- **Optimistic UI** — React 19 `useOptimistic` keeps the session runner instant while server actions sync in the background
- **Weight progression** — post-session prompts let you decide whether to increase starting weight; history is stored in a `progressions` table
- **Stats** — weight trend charts, consistency view, and per-exercise history at `/stats`
- **Observability** — `/api/health` (SQLite probe), `/metrics` (Prometheus), structured pino logs

Auth is handled upstream by Traefik forward-auth before requests reach the container.

## Development

```bash
cp infra/.env.swole.example infra/.env.swole
cd apps/swole && pnpm dev
```

Next.js starts on port `8080`. Visit http://localhost:8080.

Environment variables (see `infra/.env.swole.example`):

| Variable        | Default           | Purpose                    |
|-----------------|-------------------|----------------------------|
| `DATABASE_PATH` | `./swole.db`      | SQLite file path           |
| `FRONTEND_PORT` | `8080`            | Next.js listen port        |
| `NODE_ENV`      | `development`     | Node environment           |
| `TZ`            | `America/Los_Angeles` | Timezone for day-code logic |

## Stack

- Next.js 16 + React 19 + MUI 7 + Tailwind v4
- TypeScript 5.9
- SQLite via `better-sqlite3` + Drizzle ORM 0.45
- Zod 4 for validation
- Recharts for stats charts, `@dnd-kit` for exercise reordering
- pino logger, prom-client metrics

## Data model

Five tables: `routines`, `exercises`, `sessions`, `set_logs`, `progressions`.

Key invariants enforced at the database level:
- One active session per routine (unique partial index on `(routineId)` where `completedAt IS NULL`)
- No routine edits or archiving while a session is active
- Canonical starting weight = latest row in `progressions`

## Production

Deployed at `swole.lilnas.io` via `deploy.yml`. SQLite data lives at `/storage/app-data/swole/swole.db` on the host (`/data/swole.db` inside the container — must be owned by UID 1000).

```bash
# Deploy
docker-compose -f deploy.yml up -d

# Logs
docker-compose -f deploy.yml logs -f swole
```

The `/metrics` route is blocked externally at Traefik; Prometheus scrapes via the Docker network.

## Testing

```bash
pnpm test         # Jest unit + integration tests
pnpm test:watch   # Watch mode
```

Tests cover the session-machine FSM exhaustively (`src/core/session-machine.spec.ts`) and the database layer via integration tests (`src/db/__tests__/`).
