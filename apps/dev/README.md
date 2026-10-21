# dev

The dev.lilnas.io dashboard: lists, starts, stops and reaps the dev stacks
(`*.dev.lilnas.io`) defined in this repo's `deploy.dev.yml` files and in the
external projects under `DEV_PROJECTS_ROOT`.

NestJS backend (port 8081) plus Next.js frontend (port 8080) in one package.
The frontend proxies `/api/*` to the backend.

## Running

```bash
BACKEND_PORT=8081 FRONTEND_PORT=8080 pnpm --filter @lilnas/dev dev
```

Run `pnpm --filter @lilnas/utils build` first in a fresh checkout.

## Environment

See `.env.example`.

| Key                      | Default                 | Purpose                                      |
| ------------------------ | ----------------------- | -------------------------------------------- |
| `BACKEND_PORT`           | `8081`                  | Backend listen port                          |
| `FRONTEND_PORT`          | `8080`                  | `next dev` port (dev script only)            |
| `LILNAS_REPO`            | `/home/jeremy/lilnas`   | Repo checkout containing `deploy.dev.yml`s   |
| `DEV_PROJECTS_ROOT`      | `/home/jeremy/dev`      | External dev projects                        |
| `AUTH_URL`               | `http://auth:8081`      | Auth service (host activity)                 |
| `DEFAULT_MAX_IDLE_HOURS` | `2`                     | Idle window before a stack is reapable       |
| `DOCKER_SOCKET`          | `/var/run/docker.sock`  | Docker Engine socket                         |
| `DOCKER_BIN`             | `docker`                | Docker CLI used for `docker compose`         |
