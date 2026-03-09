# Yoink — Implementation Tasks

Status overview of every feature defined in [README.md](README.md) and
[DESIGN.md](DESIGN.md), tracked against the current codebase.

---

## Foundation

### Infrastructure & Configuration

- [x] `package.json` with dependencies (Next.js 16, NextAuth v5, Drizzle, Tailwind v4, MUI, MUI Icons)
- [x] `tsconfig.json` with path aliases
- [x] `next.config.ts` with standalone output and Google image remote patterns
- [x] `tailwind.config.ts` content paths
- [x] `postcss.config.cjs`
- [x] `eslint.config.cjs` shared monorepo config
- [x] `src/theme.ts` MUI theme with Phosphor Terminal tokens (palette, typography, component overrides)
- [x] `drizzle.config.ts` for schema and migrations
- [x] `scripts/dev.sh` disposable Postgres + dev server
- [x] `Dockerfile` multi-stage production build
- [x] `deploy.yml` production (Traefik, SSL, forward-auth)
- [x] `deploy.dev.yml` development (localhost)

### Design System (`src/tailwind.css`)

- [x] Carbon surface color ramp (`carbon-950` through `carbon-50`)
- [x] Phosphor green accent ramp + `terminal` token
- [x] Semantic status colors (error, warning, info, success) with muted variants
- [x] Font variables (`--font-mono`, `--font-sans`)
- [x] Animation keyframes (glow-pulse, terminal-blink, fade-in, slide-in-right)
- [x] Custom utilities (glow-sm/md/lg, text-glow, text-glow-sm, scanlines, cursor-blink)
- [x] Base layer (dark color-scheme, body styles, heading styles, selection, scrollbar)
- [x] Reduced motion media query (`prefers-reduced-motion: reduce` global override)

### Utilities & Hooks

- [x] `cns()` class name utility (`@lilnas/utils/cns`)
- [x] `useMediaQuery()` from MUI for responsive breakpoints

### Database

- [x] Drizzle ORM setup (`src/db/index.ts`)
- [x] Auth.js schema (`src/db/schema.ts`) — users, accounts, sessions, verificationTokens
- [x] User status enum (`pending`, `approved`, `denied`)

### Authentication

- [x] NextAuth v5 config with Google provider (`src/auth.config.ts`)
- [x] Drizzle adapter with auto-approve for admin email (`src/auth.ts`)
- [x] Middleware protecting authenticated routes (`src/middleware.ts`)
- [x] NextAuth API route (`src/app/api/auth/[...nextauth]/route.ts`)
- [x] Health check endpoint (`src/app/api/health/route.ts`)
- [x] `getAuthenticatedUser()` helper with `image` and `isAdmin` (`src/lib/user-status.ts`)
- [x] `AuthenticatedUser` type export (`src/lib/user-status.ts`)
- [x] Server actions: `signInWithGoogle`, `signOutAction` (`src/app/(auth)/login/actions.ts`)

---

## Primitive Components (MUI)

- [x] **Button** — MUI `Button` / `IconButton` themed via `createTheme` overrides
- [x] **Card** — MUI `Card` / `CardContent` / `CardHeader` themed to Phosphor Terminal
- [x] **Chip** — MUI `Chip` with semantic color variants (replaces Badge)
- [x] **EmptyState** — custom component with Tailwind classes (`src/components/empty-state.tsx`)
- [x] **StatusBadge** — account status mapping using MUI `Chip` (`src/components/status-badge.tsx`)
- [x] **TextField** — MUI `TextField` themed dark (`variant="outlined"`)
- [x] **Divider** — MUI `Divider` (replaces Separator)
- [x] **Drawer** — MUI `Drawer` (temporary for mobile sidebar, permanent for desktop)
- [x] **Skeleton** — MUI `Skeleton` with phosphor green tint
- [x] **Tooltip** — MUI `Tooltip` themed to Phosphor Terminal
- [x] **Progress** — MUI `LinearProgress` styled with phosphor green fill + glow
- [x] **FilterToggle** — MUI `ToggleButtonGroup` (Both / Movies / Shows)

---

## Feature Components

- [x] **MediaCard** — poster card with title, year, quality badge, status dot, hover lift, missing-poster placeholder, optional media type chip
- [x] **DownloadProgress** — progress bar card with title, percent, speed, ETA, size info, status badge, retry button for failed
- [x] **SearchBar** — terminal-styled input with Search icon, focus-within glow (`src/components/search-bar.tsx`)
- [x] **UserCard** — admin row with avatar (fallback initials), name, email, timestamp, status badge, approve/deny actions
- [x] **SeasonAccordion** — expandable season header with episode count, download ratio, mini progress bar, chevron rotation
- [x] **EpisodeItem** — episode row with number, title, quality badge, status badge, inline download progress, action buttons (download + releases dialog)
- [ ] **StorageBar** — segmented disk usage bar (movies/shows), label, used/total stats, warning/critical thresholds
- [ ] **EventItem** — history feed row with event type icon + color, title, quality badge, relative timestamp, link to detail
- [x] **ActionMenu** — contextual download/delete/re-download/retry actions based on download status, confirmation dialogs

---

## App Shell

The authenticated layout wrapping Library, Search, Downloads, History,
Storage, and Admin pages.

- [x] **Shell layout** — sidebar (`w-56`, `carbon-800`) + main content area (`flex-1`, `overflow-y-auto`, `max-w-6xl`)
- [x] **Top bar** — `h-14`, logo left, user avatar + name + sign-out button right (search input removed; search is now a full page)
- [x] **Sidebar navigation** — icon + label links for Search, Library, Downloads, History, Storage (Search first)
  - [x] Active state: `bg-terminal/10 text-terminal border-l-2 border-terminal`
  - [x] Inactive state: `text-carbon-400 hover:text-carbon-200 hover:bg-carbon-700/50`
  - [x] Admin link separated by divider, visible only for admin users
- [x] **Responsive behavior** — mobile sidebar collapse / drawer

---

## Pages

### Auth Pages

- [x] **Login** — full-screen centered, scanlines overlay, Google SSO button (`src/app/(auth)/login/page.tsx`)
- [x] **Pending** — full-screen EmptyState with Clock icon and StatusBadge (`src/app/(auth)/pending/page.tsx`)
- [~] **Denied** — ~~full-screen EmptyState with ShieldX icon~~ — "denied" status removed; non-approved users redirect to `/pending`

### Search (Home — `/`)

- [x] Route at `/` — landing page, first view after login (`src/app/(library)/page.tsx`)
- [x] SearchBar sticky at top (`sticky top-0 z-10 bg-carbon-900/95 backdrop-blur-sm`)
- [x] Search results in MediaCard grid with media type chip when filter is "all"
- [x] Initial empty state ("Search for media")
- [x] No-results empty state ("No results — try a different search term")
- [x] Debounced search queries (400ms) to Radarr and Sonarr lookup APIs
- [x] Filter toggle for movies / shows / both
- [x] Sort select with relevance (default), title, date added, release date
- [x] Server action for search (`src/app/(library)/search/actions.ts`)
- [x] URL sync — query param `?q=` updated on search, restored on page load

### Library (`/library`)

- [x] Route group layout with auth guards (`src/app/(library)/layout.tsx`)
- [x] Library page moved to `/library` (`src/app/(library)/library/page.tsx`)
- [x] Page header with "Library" title and FilterToggle
- [x] Responsive MediaCard grid (`grid-cols-2 sm:3 md:4 lg:5 xl:6 gap-4`)
- [x] Empty state when nothing is downloaded yet ("No movies or shows downloaded yet")
- [x] Fetch downloaded library data from Radarr (movies) and Sonarr (shows) APIs
- [x] Filter logic for movies / shows / both

### Movie Detail (`/movie/[id]`)

- [x] Top section: poster (`w-48 aspect-[2/3]`) + metadata (title, year, runtime, rating, quality badge)
- [x] Overview paragraph (`font-sans text-carbon-200 leading-relaxed max-w-prose`)
- [x] ActionMenu (download / delete / re-download based on status)
- [x] Inline DownloadProgress when actively downloading
- [x] Files section: Card table with filename, size, quality columns
- [x] Fetch movie data from Radarr API
- [x] Server actions: trigger download, delete movie file, re-download

### Show Detail (`/show/[id]`)

- [x] Top section: poster + metadata (title, year, season count, rating, status badge)
- [x] Overview paragraph
- [x] Series-level ActionMenu (add/remove library)
- [x] SeasonAccordion stack with EpisodeItem rows inside each
- [x] Per-episode inline DownloadProgress when downloading
- [x] Per-episode actions: download, delete, browse releases (release list dialog)
- [x] Fetch show data from Sonarr API (series + episodes)
- [x] Server actions: trigger download, delete, re-download at series/episode level

### Downloads (`/downloads`)

- [x] Page header with "Downloads" title and total count badge
- [x] Movies section with count badge and `MovieDownloadCard` grid (progress bar, release title, size, ETA, cancel action)
- [x] Shows section with `ShowDownloadGroup` cards, grouped by season (`SeasonDownloadGroup`) with per-episode rows (`EpisodeDownloadRow`)
- [x] Sections only render when they have items
- [x] Cancel actions at every level: movie, full show, season, individual episode — with confirmation dialogs
- [x] Empty state ("No active downloads — Downloads will appear here as they start")
- [x] Fetch queue data from Radarr and Sonarr APIs (via NestJS backend `DownloadService`)
- [x] Real-time WebSocket updates for progress/speed/ETA via `DownloadGateway` + `DownloadPollerService` (3s polling interval)

### History (`/history`)

- [ ] Page header with "History" title and FilterToggle
- [ ] Event type filter chips (grabbed, imported, upgraded, deleted, failed) as toggleable badges
- [ ] EventItem feed in reverse-chronological order
- [ ] Click any entry to navigate to movie/show detail
- [ ] Infinite scroll pagination (load more on scroll near bottom)
- [ ] Fetch history from Radarr and Sonarr APIs
- [ ] Filter logic for event types and movies/shows

### Storage (`/storage`)

- [ ] Page header with "Storage" title
- [ ] Warning banner (`bg-warning-muted border-warning/30`) when any root folder exceeds threshold
- [ ] StorageBar for each root folder (movies, shows)
- [ ] "Largest Items" table in Card — title (linked), file size, quality badge, sorted by size descending, top 20
- [ ] Fetch root folder stats from Radarr and Sonarr APIs
- [ ] Fetch largest items from Radarr and Sonarr APIs

### Admin (`/admin`)

- [x] Guard: only accessible to admin users, redirect non-admins
- [x] "Pending Requests" section with count badge and UserCard list
- [x] "Approved Users" section with count badge and UserCard list
- [x] Empty pending state ("No pending requests — all access requests have been handled")
- [x] Server actions: approve user, deny user (update status in database)
- [x] Optimistic UI updates on approve/deny

---

## API Integration

### Radarr Client

- [x] HTTP client for Radarr API (base URL + API key from env)
- [x] GET movies (library)
- [x] GET movie by ID (detail)
- [x] GET movie lookup (search)
- [x] GET queue (active/queued downloads)
- [ ] GET history (events)
- [ ] GET root folders (storage)
- [x] POST command: movie search (trigger download)
- [x] DELETE movie file
- [x] DELETE queue item (cancel download)

### Sonarr Client

- [x] HTTP client for Sonarr API (base URL + API key from env)
- [x] GET series (library)
- [x] GET series by ID (detail)
- [x] GET series lookup (search)
- [x] GET episodes for series
- [x] GET episode files for series
- [x] GET queue (active/queued downloads)
- [ ] GET history (events)
- [ ] GET root folders (storage)
- [x] POST command: episode search (trigger download)
- [x] DELETE episode file
- [x] DELETE queue item (cancel download)

### Environment Variables

- [x] `RADARR_URL` — Radarr API base URL
- [x] `RADARR_API_KEY` — Radarr API key
- [x] `SONARR_URL` — Sonarr API base URL
- [x] `SONARR_API_KEY` — Sonarr API key
- [x] Add to `infra/.env.yoink.example` and README env table

---

## NestJS Backend

### Server Infrastructure

- [x] NestJS bootstrap with custom server (`src/bootstrap.ts`)
- [x] App module wiring (`src/app.module.ts`)
- [x] Environment configuration (`src/env.ts`)

### Auth Module

- [x] `AuthService` — JWT token issuance and NextAuth session cookie verification
- [x] `AuthController` — `/api/auth/token` endpoint for JWT exchange
- [x] `JwtAuthGuard` — protects backend API routes via JWT validation
- [x] `AUTH_TOKEN_COOKIE` constant for cookie-based auth

### Media Module

- [x] `LibraryService` — fetches combined movie/show library from Radarr + Sonarr
- [x] `LibraryController` — `/api/library` endpoint
- [x] `MoviesService` — movie lookup, detail, download, release grab, file delete, queue cancel
- [x] `MoviesController` — `/api/movies/*` endpoints (detail, search, download, releases, status, files, cancel)
- [x] `ShowsService` — series lookup, detail, episode/season/series download, release grab, file delete, queue cancel
- [x] `ShowsController` — `/api/shows/*` endpoints (detail, search, download, releases, status, episodes, cancel)
- [x] Shared Radarr/Sonarr HTTP client helpers (`src/media/clients.ts`)
- [x] Search result tracking (`src/media/search-results.ts`) — records "not found" results to avoid repeated failed searches

### Download Module

- [x] `DownloadService` — in-memory tracked download state, download orchestration (movie search, release grab, episode/season/series search), cancel at all levels, status snapshots, `getAllDownloads()` with rich metadata
- [x] `DownloadPollerService` — 3s interval polling of Radarr/Sonarr queues, state machine (searching → grabbing → progress → completed/failed), command status polling for search completion detection, pending cancel cleanup
- [x] `DownloadGateway` — WebSocket gateway (`/downloads` namespace) with JWT cookie auth, broadcasts download lifecycle events (initiated, grabbing, progress, completed, failed, cancelled)
- [x] `DownloadController` — REST endpoints for download requests, status, cancel
- [x] `DownloadTypes` — comprehensive type definitions (tracked downloads, event payloads, status responses, request types)

### Frontend API Layer

- [x] `api.server.ts` — server-side API client (direct NestJS service calls via fetch with auth cookie forwarding)
- [x] `api.client.ts` — client-side API client (browser fetch to backend endpoints with credentials)
- [x] `useDownloadState` / `useShowDownloadState` / `useAllDownloadsState` hooks — WebSocket-powered reactive download state for movie detail, show detail, and downloads page

### Testing

- [x] Jest configuration (`jest.config.js`) with TypeScript/SWC transform and path alias support
- [x] Test setup (`src/__tests__/setup.ts`)
- [x] `AuthService` unit tests (`src/auth/__tests__/auth.service.test.ts`)
- [x] `JwtAuthGuard` unit tests (`src/auth/__tests__/jwt-auth.guard.test.ts`)
- [x] `DownloadService` unit tests (`src/download/__tests__/download.service.test.ts`)
- [x] `DownloadGateway` unit tests (`src/download/__tests__/download.gateway.test.ts`)
- [x] `DownloadPollerService` unit tests (`src/download/__tests__/download-poller.service.test.ts`)
- [x] `DownloadTypes` unit tests (`src/download/__tests__/download.types.test.ts`)
- [x] `LibraryService` unit tests (`src/media/__tests__/library.service.test.ts`)
- [x] `MoviesService` unit tests (`src/media/__tests__/movies.service.test.ts`)
- [x] `ShowsService` unit tests (`src/media/__tests__/shows.service.test.ts`)
- [x] Media format helpers unit tests (`src/media/__tests__/format.test.ts`)
- [x] Sort helpers unit tests (`src/media/__tests__/sort.test.ts`)
- [x] Release parsing unit tests (`src/media/__tests__/parse-release.test.ts`)
- [x] Legacy library/movies/shows integration tests

---

## Polish & Quality

- [ ] Loading skeletons for data-fetching pages (library grid, search results, detail pages)
- [ ] Error boundaries / error pages for API failures
- [~] Staggered entrance animations — implemented on Downloads page (`animationDelay: index * 60ms`), not yet on MediaCard grids
- [ ] Download queue entrance/exit animations (fade-in on add, fade-out on complete)
- [ ] Season accordion smooth height animation (`grid-rows-[0fr]` to `grid-rows-[1fr]`)
- [ ] `⌘K` keyboard shortcut to focus search
- [x] Confirmation dialogs for destructive actions (delete movie/episode files)
- [x] Relative timestamp formatting (e.g. "3 hours ago") for history and admin
- [ ] Metadata: page titles and descriptions per route
