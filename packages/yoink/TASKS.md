# Yoink — Implementation Tasks

Status overview of every feature defined in [README.md](README.md) and
[DESIGN.md](DESIGN.md), tracked against the current codebase.

---

## Foundation

### Infrastructure & Configuration

- [x] `package.json` with dependencies (Next.js 16, NextAuth v5, Drizzle, Tailwind v4, Radix, CVA, Lucide)
- [x] `tsconfig.json` with path aliases
- [x] `next.config.ts` with standalone output
- [x] `tailwind.config.ts` content paths
- [x] `postcss.config.cjs`
- [x] `eslint.config.cjs` shared monorepo config
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
- [ ] Reduced motion media query (`prefers-reduced-motion: reduce` global override from DESIGN.md)

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
- [x] `getAuthenticatedUser()` helper (`src/lib/user-status.ts`)
- [x] Server actions: `signInWithGoogle`, `signOutAction` (`src/app/login/actions.ts`)

---

## Primitive Components

- [x] **Button** — CVA variants (default, secondary, outline, ghost, destructive, link), sizes, asChild (`src/components/button.tsx`)
- [x] **Card** — variants (default, glow, inset), CardHeader, CardContent (`src/components/card.tsx`)
- [x] **Badge** — variants (default, secondary, success, error, warning, info, outline) (`src/components/badge.tsx`)
- [x] **EmptyState** — icon, title, description, action slot (`src/components/empty-state.tsx`)
- [x] **StatusBadge** — account status mapping (pending/approved/denied) (`src/components/status-badge.tsx`)
- [ ] **Input** — monospace styled input with terminal focus ring
- [ ] **Progress** — phosphor green fill bar with glow, 0–100 value
- [ ] **FilterToggle** — three-button radio group (Both / Movies / Shows)

---

## Feature Components

- [ ] **MediaCard** — poster card with title, year, quality badge, status dot, hover lift, missing-poster placeholder
- [ ] **DownloadProgress** — progress bar card with title, percent, speed, ETA, size info, status badge, retry button for failed
- [ ] **SearchBar** — terminal-styled input with Search icon, integrated FilterToggle, `⌘K` hint, focus-within glow
- [ ] **UserCard** — admin row with avatar (fallback initials), name, email, timestamp, status badge, approve/deny actions
- [ ] **SeasonAccordion** — expandable season header with episode count, download ratio, mini progress bar, chevron rotation
- [ ] **EpisodeItem** — episode row with number, title, quality badge, status badge, inline download progress, action buttons
- [ ] **StorageBar** — segmented disk usage bar (movies/shows), label, used/total stats, warning/critical thresholds
- [ ] **EventItem** — history feed row with event type icon + color, title, quality badge, relative timestamp, link to detail
- [ ] **ActionMenu** — contextual download/delete/re-download/retry actions based on download status, confirmation dialogs

---

## App Shell

The authenticated layout wrapping Dashboard, Search, Downloads, History,
Storage, and Admin pages.

- [ ] **Shell layout** — sidebar (`w-56`, `carbon-800`) + main content area (`flex-1`, `overflow-y-auto`, `max-w-6xl`)
- [ ] **Top bar** — `h-14`, logo left, user avatar + name + sign-out button right
- [ ] **Sidebar navigation** — icon + label links for Dashboard, Search, Downloads, History, Storage
  - [ ] Active state: `bg-terminal/10 text-terminal border-l-2 border-terminal`
  - [ ] Inactive state: `text-carbon-400 hover:text-carbon-200 hover:bg-carbon-700/50`
  - [ ] Admin link separated by divider, visible only for admin users
- [ ] **Responsive behavior** — mobile sidebar collapse / drawer

---

## Pages

### Auth Pages

- [x] **Login** — full-screen centered, scanlines overlay, Google SSO button (`src/app/login/page.tsx`)
- [x] **Pending** — full-screen EmptyState with Clock icon and StatusBadge (`src/app/pending/page.tsx`)
- [ ] **Denied** — full-screen EmptyState with ShieldX icon, "Access Denied" message, re-request access button
  - Currently denied users redirect to `/login` instead of a dedicated denied page

### Dashboard (`/dashboard` or `/`)

- [ ] Replace placeholder `src/app/page.tsx` with real dashboard
- [ ] Page header with "Library" title and FilterToggle
- [ ] Responsive MediaCard grid (`grid-cols-2 sm:3 md:4 lg:5 xl:6 gap-4`)
- [ ] Empty state when no downloads ("Search for movies and shows to get started" + link to Search)
- [ ] Fetch library data from Radarr (movies) and Sonarr (shows) APIs
- [ ] Filter logic for movies / shows / both

### Search (`/search`)

- [ ] SearchBar sticky below top bar (`sticky top-14 z-10 bg-carbon-900/95 backdrop-blur`)
- [ ] Search results in MediaCard grid
- [ ] Initial empty state ("Search for media")
- [ ] No-results empty state ("No results — try a different search term")
- [ ] Debounced search queries to Radarr and Sonarr lookup APIs
- [ ] Filter toggle for movies / shows / both

### Movie Detail (`/movie/[id]`)

- [ ] Top section: poster (`w-48 aspect-[2/3]`) + metadata (title, year, runtime, rating, quality badge)
- [ ] Overview paragraph (`font-sans text-carbon-200 leading-relaxed max-w-prose`)
- [ ] ActionMenu (download / delete / re-download based on status)
- [ ] Inline DownloadProgress when actively downloading
- [ ] Files section: Card table with filename, size, quality columns
- [ ] Fetch movie data from Radarr API
- [ ] Server actions: trigger download, delete movie file, re-download

### Show Detail (`/show/[id]`)

- [ ] Top section: poster + metadata (title, year, season count, rating, status badge)
- [ ] Overview paragraph
- [ ] Series-level ActionMenu
- [ ] SeasonAccordion stack with EpisodeItem rows inside each
- [ ] Per-episode inline DownloadProgress when downloading
- [ ] Per-episode ActionMenu (download / delete / re-download)
- [ ] Fetch show data from Sonarr API (series + episodes)
- [ ] Server actions: trigger download, delete, re-download at series/season/episode level

### Downloads (`/downloads`)

- [ ] Three grouped sections: "Active", "Queued", "Failed" — each with H3 heading and count badge
- [ ] DownloadProgress cards in each section, clickable to detail page
- [ ] Sections only render when they have items
- [ ] Failed downloads show error reason and retry action
- [ ] Empty state ("No active downloads — everything is up to date")
- [ ] Fetch queue data from Radarr and Sonarr APIs
- [ ] Polling or real-time updates for progress/speed/ETA

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

- [ ] Guard: only accessible to admin users, redirect non-admins
- [ ] "Pending Requests" section with count badge and UserCard list
- [ ] "Approved Users" section with count badge and UserCard list
- [ ] Empty pending state ("No pending requests — all access requests have been handled")
- [ ] Server actions: approve user, deny user (update status in database)
- [ ] Optimistic UI updates on approve/deny

---

## API Integration

### Radarr Client

- [ ] HTTP client for Radarr API (base URL + API key from env)
- [ ] GET movies (library)
- [ ] GET movie by ID (detail)
- [ ] GET movie lookup (search)
- [ ] GET queue (active/queued downloads)
- [ ] GET history (events)
- [ ] GET root folders (storage)
- [ ] POST command: movie search (trigger download)
- [ ] DELETE movie file
- [ ] DELETE queue item (cancel download)

### Sonarr Client

- [ ] HTTP client for Sonarr API (base URL + API key from env)
- [ ] GET series (library)
- [ ] GET series by ID (detail)
- [ ] GET series lookup (search)
- [ ] GET episodes for series
- [ ] GET episode files for series
- [ ] GET queue (active/queued downloads)
- [ ] GET history (events)
- [ ] GET root folders (storage)
- [ ] POST command: episode search (trigger download)
- [ ] DELETE episode file
- [ ] DELETE queue item (cancel download)

### Environment Variables

- [ ] `RADARR_URL` — Radarr API base URL
- [ ] `RADARR_API_KEY` — Radarr API key
- [ ] `SONARR_URL` — Sonarr API base URL
- [ ] `SONARR_API_KEY` — Sonarr API key
- [ ] Add to `infra/.env.yoink.example` and README env table

---

## Polish & Quality

- [ ] Loading skeletons for data-fetching pages (dashboard grid, search results, detail pages)
- [ ] Error boundaries / error pages for API failures
- [ ] Staggered entrance animations on MediaCard grids (`animationDelay: index * 50ms`)
- [ ] Download queue entrance/exit animations (fade-in on add, fade-out on complete)
- [ ] Season accordion smooth height animation (`grid-rows-[0fr]` to `grid-rows-[1fr]`)
- [ ] `⌘K` keyboard shortcut to focus search
- [ ] Confirmation dialogs for destructive actions (delete movie/episode files)
- [ ] Relative timestamp formatting (e.g. "3 hours ago") for history and admin
- [ ] Metadata: page titles and descriptions per route
