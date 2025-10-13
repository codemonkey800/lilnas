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

# Run tests for a package
pnpm test

# Run tests in watch mode
pnpm test:watch

# Clean all node_modules (useful for troubleshooting)
pnpm run clean:modules
```

### Testing

```bash
# Run tests in packages that have test suites
pnpm test

# Run tests in watch mode for development
pnpm test:watch

# Test files are located in __tests__ directories
# Packages with test coverage:
# - @lilnas/utils - Utility functions testing with Jest
# - @lilnas/tdr-bot - Message handler and service tests
# Tests are automatically run in CI for changed packages
# Coverage reports are generated in coverage/ directories
```

### Service Management

```bash
# Start services in development mode
docker-compose -f docker-compose.dev.yml up -d

# Start specific service
docker-compose -f docker-compose.dev.yml up -d <service-name>

# View service logs
docker-compose -f docker-compose.dev.yml logs -f <service-name>

# Show status of services
docker-compose -f docker-compose.dev.yml ps

# Start a shell within a container
docker-compose -f docker-compose.dev.yml exec <service-name> sh

# Stop services
docker-compose -f docker-compose.dev.yml down

# Production deployment commands
docker-compose up -d [services...]      # Deploy services
docker-compose down [services...]       # Bring down services
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

# For Vite-based frontends (dashcam)
pnpm run dev      # Development server (port 8080)
pnpm run build    # Production build
pnpm run preview  # Preview production build

# For hybrid apps (tdr-bot, download)
pnpm run dev              # Both backend + frontend
pnpm run dev:backend      # Backend only
pnpm run dev:frontend     # Frontend only
pnpm run dev:graph-test   # Special mode for tdr-bot AI testing (GRAPH_TEST=true)

# Testing (where available)
pnpm test                 # Run tests for the package
pnpm test:watch          # Run tests in watch mode
```

## CI/CD and GitHub Actions

The project uses GitHub Actions for continuous integration and AI-powered development assistance.

### Automated Testing Workflow

The `test.yml` workflow automatically:

- Detects changed packages in PRs
- Runs tests only for affected packages
- Executes lint and type-check for changed code
- Uploads test results and coverage reports
- Uses pnpm caching for fast builds

### Claude AI Integration

Two Claude-specific workflows enhance development:

**Issue/PR Assistance (`claude.yml`)**:

- Trigger Claude Code by mentioning @claude in issues or PRs
- Supports model selection based on complexity:
  - claude-3-5-sonnet (default, fast)
  - claude-3-5-opus (complex tasks)
  - claude-3-5-haiku (simple tasks)
- Includes MCP sequential thinking for problem solving

**Automated Code Review (`claude-code-review.yml`)**:

- Automatic PR reviews using Claude AI
- Analyzes code changes and provides feedback
- Suggests improvements and catches potential issues
- Model selection based on PR size and complexity

### Workflow Commands

```bash
# Trigger Claude in issues/PRs
@claude <your request>

# Select specific model
@claude --model opus <complex request>
@claude --model haiku <simple request>
```

## Architecture Overview

### Monorepo Structure

lilnas is a TypeScript monorepo using pnpm workspaces with Turbo build orchestration. It's a self-hosted NAS system with multiple integrated services.

### Package Categories

**Frontend Applications:**

- `@lilnas/apps` - Next.js application portal/dashboard
- `@lilnas/dashcam` - Vite+React dashcam video viewer (port 8080)

**Full-Stack Applications (NestJS + Next.js):**

- `@lilnas/tdr-bot` - Discord bot with AI (LangChain, OpenAI) + admin interface
- `@lilnas/download` - Video download service with web UI (yt-dlp, ffmpeg)

**Backend Services (NestJS):**

- `@lilnas/equations` - LaTeX equation rendering with Docker sandbox security
- `@lilnas/me-token-tracker` - Cryptocurrency tracking Discord bot

**Development Tools:**

- `@lilnas/utils` - Shared utilities and types
- `@lilnas/eslint` - Shared ESLint config
- `@lilnas/prettier` - Shared Prettier config

### Infrastructure Stack

- **Reverse Proxy:** Traefik with Let's Encrypt SSL
- **Storage:** MinIO (S3-compatible object storage)
- **Authentication:** Forward Auth with OAuth
- **Development:** Docker Compose with volume mounts
- **Production:** Multi-stage Docker builds

### Storage Architecture

The server uses a semantic directory structure for organizing different types of data. See `docs/semantic-storage.md` for comprehensive documentation about:

- Storage directory purposes and usage patterns
- Volume mapping configurations
- Backup tier strategy
- Best practices for storage planning

### Key Docker Compose Files

**Root-level orchestration:**

- `docker-compose.yml` / `docker-compose.dev.yml` - Main orchestration files

**Infrastructure services in `infra/`:**

- `proxy.yml` / `proxy.dev.yml` - Traefik and authentication
- `shared.yml` / `shared.dev.yml` - Storage and shared services
- `media.yml` - Media stack (Sonarr, Radarr, Emby)
- `immich.yml` - Photo management
- `monitoring.yml` - System monitoring
- `minecraft.yml` - Minecraft server deployment
- `palworld.yml` - Palworld game server deployment

**Package-specific deployment:**

- `packages/*/deploy.yml` - Production deployment for each service
- `packages/*/deploy.dev.yml` - Development deployment for each service

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

### Docker Development Workflow

1. Start services with `docker-compose -f docker-compose.dev.yml up -d <service>`
2. View logs with `docker-compose -f docker-compose.dev.yml logs -f <service>`
3. Services auto-reload with volume mounts

### Docker Base Images

The project uses a layered Docker base image system for consistent environments:

**Image Hierarchy:**

- `lilnas-node-base` - Base Node.js environment with common dependencies
- `lilnas-monorepo-builder` - Build environment with pnpm and turbo
- `lilnas-node-runtime` - Lightweight runtime for Node.js services
- `lilnas-nextjs-runtime` - Specialized runtime for Next.js applications

**Building Base Images:**

```bash
# Build all base images (run from project root)
./infra/base-images/build-base-images.sh

# Images are used automatically by service Dockerfiles
# Rebuild base images when:
# - Updating Node.js version
# - Changing base dependencies
# - Updating pnpm version
# - Making significant changes to the build process
```

**Important: Docker Cache and Source Code Updates**

The `lilnas-monorepo-builder` base image contains a snapshot of the source code. When you make changes to your code and redeploy, the changes might not be reflected because the base image is cached. To ensure fresh source code is deployed:

```bash
# Option 1: Rebuild base images first (recommended)
./infra/base-images/build-base-images.sh
docker-compose up -d --build <service>

# Option 2: Remove all images to force complete rebuild
docker-compose down --rmi all
docker-compose up -d <service>
```

### Build Process

- Turbo orchestrates builds with dependency awareness
- Multi-stage Docker builds separate build and runtime
- TypeScript compilation uses SWC for performance
- Next.js apps use standalone output for Docker optimization

### Turbo Build System

Turbo (v2.5.4) provides intelligent build orchestration with caching:

**Configuration (`turbo.json`):**

- Build outputs: `.next/**` and `dist/**` directories
- Dependency-aware builds: `dependsOn: ["^build"]` ensures dependencies build first
- Automatic caching prevents unnecessary rebuilds

**Cache Management:**

```bash
# Clear turbo cache (included in pnpm run clean)
rm -rf .turbo

# Force rebuild without cache
pnpm run build --force

# See what would be built
pnpm run build --dry-run
```

### Environment Configuration

- Development: `docker-compose.dev.yml` with localhost
- Production: `docker-compose.yml` with SSL and domains
- Service discovery via Traefik labels
- Environment variables defined in Docker Compose files

### Production Deployment

Each package includes production-ready deployment configuration:

**Deployment Files:**

- `packages/*/deploy.yml` - Production Docker Compose for each service
- Uses `*.lilnas.io` domains with automatic SSL via Let's Encrypt
- Traefik authentication middleware (`forward-auth@file`)
- Restart policies: `unless-stopped` for reliability

**Production Commands:**

```bash
# Deploy a specific service
cd packages/<service-name>
docker-compose -f deploy.yml up -d

# View production logs
docker-compose -f deploy.yml logs -f

# Update and redeploy
docker-compose -f deploy.yml pull
docker-compose -f deploy.yml up -d
```

### Environment Variables

Environment configuration follows a secure pattern:

- **Example files:** `deploy/.env.example` shows required variables
- **Service-specific:** Each docker-compose file defines its own variables
- **No centralized .env:** Intentional design for security isolation
- **Development defaults:** Most services work with default values in dev
- **Production secrets:** Must be explicitly set, never committed

## Best Practices

### Container and File Management

- Always cleanup docker containers that are created for commands. Always clean up any temporary files too. This happen only after completion in case the temporary files or containers are needed for later.

## Code Quality and Development Guidelines

### Coding Standards

- Follow coding conventions based on the prettier and eslint config
- ESLint configurations use the new flat config format (`eslint.config.cjs`)
- Each package has its own ESLint configuration
- Try to avoid using `any` types
- Always write optimal code that follows best practices
- **Whenever writing to a file, ensure that it passes prettier and lint checks for the package you're editing the file in.**

## Domain Configuration

### Local Development Domains

- Local services will be located under the \*.localhost subdomain. For example, traefik.localhost or storage.localhost.

```

```
