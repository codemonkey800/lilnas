# @lilnas/swole

Workout app — skeleton scaffold.

Single Next.js 16 process. No database, no auth, no domain features yet — just a runnable shell with `/api/health`, `/metrics`, and a placeholder home page.

## Development

```bash
cp infra/.env.swole.example infra/.env.swole
cd apps/swole && pnpm dev
```

This starts Next.js on port `8080`. Visit http://localhost:8080.

## Stack

- Next.js 16 + React 19 + MUI 7 + Tailwind v4
- TypeScript 5.9
- pino logger, prom-client metrics

Data-flow direction is recorded in [docs/adr/001-data-flow.md](docs/adr/001-data-flow.md).
