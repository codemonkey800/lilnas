# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Build & Development

```bash
# Install all dependencies
pnpm install

# Build all packages (uses Turbo for caching)
pnpm run build

# Run linting across all packages
pnpm run lint
pnpm run lint:fix

# Type check all packages
pnpm run type-check

# Clean all build artifacts
pnpm run clean
```

### Service Management (lilnas CLI)

```bash
# Execute lilnas CLI directly
./lilnas

# List all available services
./lilnas dev ls

# Sync container dependencies (required before first run)
./lilnas dev sync-deps

# Start specific service in dev mode
./lilnas dev start <service-name>

# View service logs
./lilnas dev logs <service-name> -f

# Stop services
./lilnas dev down

# IMPORTANT: Service Management Commands
# When using the lilnas CLI, you can bring up development services:
# - Bring up services: lilnas dev up -d
# - Bring down services: lilnas dev down
# - Clean all images: lilnas dev down --all
```

### Individual Package Development

```bash
# Work in specific package
cd packages/<package-name>

# For NestJS backends (equations, me-token-tracker)
pnpm run dev      # Hot-reload development server
pnpm run build    # Production build
pnpm run start    # Run production build

# For Next.js frontends (apps)
pnpm run dev      # Development server
pnpm run build    # Production build
pnpm run start    # Production server

# For hybrid apps (tdr-bot, download)
pnpm run dev              # Both backend + frontend
pnpm run dev:backend      # Backend only
pnpm run dev:frontend     # Frontend only
pnpm run dev:graph-test   # Special mode for tdr-bot AI testing
```

## Architecture Overview

### Monorepo Structure

LilNAS is a TypeScript monorepo using pnpm workspaces with Turbo build orchestration. It's a self-hosted NAS system with multiple integrated services.

### Package Categories

**Frontend Applications:**

- `@lilnas/apps` - Next.js application portal/dashboard
- `@lilnas/dashcam` - Vite+React dashcam video viewer

**Full-Stack Applications (NestJS + Next.js):**

- `@lilnas/tdr-bot` - Discord bot with AI (LangChain, OpenAI) + admin interface
- `@lilnas/download` - Video download service with web UI (yt-dlp, ffmpeg)

**Backend Services (NestJS):**

- `@lilnas/equations` - LaTeX equation rendering with Docker sandbox security
- `@lilnas/me-token-tracker` - Cryptocurrency tracking Discord bot

**Development Tools:**

- `@lilnas/cli` - Docker Compose management CLI (yargs-based)
- `@lilnas/utils` - Shared utilities and types
- `@lilnas/eslint` - Shared ESLint config
- `@lilnas/prettier` - Shared Prettier config

### Infrastructure Stack

- **Reverse Proxy:** Traefik with Let's Encrypt SSL
- **Storage:** MinIO (S3-compatible object storage)
- **Authentication:** Forward Auth with OAuth
- **Development:** Docker Compose with volume mounts
- **Production:** Multi-stage Docker builds

### Key Docker Compose Files

Located in `infra/`:

- `apps.yml` / `apps.dev.yml` - Application services
- `proxy.yml` / `proxy.dev.yml` - Traefik and authentication
- `shared.yml` / `shared.dev.yml` - Storage and shared services
- `media.yml` - Media stack (Sonarr, Radarr, Emby, etc.)
- `immich.yml` - Photo management
- `monitoring.yml` - System monitoring

## Security Considerations

### LaTeX Equations Service Security

The equations service implements comprehensive security measures:

- **Input Validation:** Zod schemas block dangerous LaTeX commands
- **Command Injection Prevention:** Uses secure spawn without shell
- **Docker Sandbox:** Isolated LaTeX compilation with resource limits
- **Rate Limiting:** Multi-tier throttling (3/min, 20/15min, 50/hour)
- **Resource Monitoring:** Memory, CPU, and file size limits

Critical security files:

- `packages/equations/src/validation/equation.schema.ts` - Input validation
- `packages/equations/src/utils/secure-exec.ts` - Safe command execution
- `packages/equations/latex-sandbox.dockerfile` - Docker sandbox
- `packages/equations/SECURITY.md` - Complete security documentation

### Development vs Production

- **Development:** Single container, volume mounts, localhost domains
- **Production:** Multi-stage builds, SSL certificates, lilnas.io domains

## AI/LLM Integration

### TDR-Bot Architecture

The `@lilnas/tdr-bot` package includes sophisticated AI capabilities:

- **LangChain Integration:** `@langchain/core`, `@langchain/openai`, `@langchain/langgraph`
- **AI Workflows:** LangGraph for complex conversation flows
- **Tool Integration:** Tavily search, Discord.js, Docker management
- **Graph Testing Mode:** `pnpm run dev:graph-test` for AI workflow development

### Message Handling

- Message processing pipeline in `src/message-handler/`
- LLM service integration with OpenAI
- Tools and function calling capabilities
- Discord command system via Necord

## Important Development Notes

### Dependency Management

- Uses pnpm workspaces with workspace protocol (`workspace:*`)
- Shared configs ensure consistency across packages
- Turbo handles build caching and dependency order

### CLI Development

The `lilnas` CLI is implemented as a bash script:

- Bash shell: `./lilnas` (main executable)
- Implementation: `packages/cli/src/main.ts` (TypeScript)
- Uses tsx for direct TypeScript execution

### Docker Development Workflow

1. Run `./lilnas dev sync-deps` to sync container dependencies
2. Use `./lilnas dev start <service>` for development
3. Logs available via `./lilnas dev logs <service> -f`
4. Services auto-reload with volume mounts

### Build Process

- Turbo orchestrates builds with dependency awareness
- Multi-stage Docker builds separate build and runtime
- TypeScript compilation uses SWC for performance
- Next.js apps use standalone output for Docker optimization

### Environment Configuration

- Development: `docker-compose.dev.yml` with localhost
- Production: `docker-compose.yml` with SSL and domains
- Service discovery via Traefik labels
- Environment variables defined in Docker Compose files

## Best Practices

### Container and File Management

- Always cleanup docker containers that are created for commands. Always clean up any temporary files too. This happen only after completion in case the temporary files or containers are needed for later.

## Code Quality and Development Guidelines

### Coding Standards

- Follow coding conventions based on the prettier and eslint config
- Try to avoid using `any` types
- Always write optimal code that follows best practices

## Domain Configuration

### Local Development Domains

- Local services will be located under the \*.localhost subdomain. For example, traefik.localhost or storage.localhost.
