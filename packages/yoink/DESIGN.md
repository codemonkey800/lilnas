# Yoink Design System — "Phosphor Terminal"

## Philosophy & Aesthetic Direction

Phosphor Terminal draws from the look and feel of vintage CRT phosphor-green monitors — refined for modern web UI. Deep charcoal surfaces, electric green accents, monospace-forward typography, and subtle glow effects create an interface that feels like a download operations console rather than a generic library view. Every screen — from the login gate to the storage overview — should read like a purpose-built terminal for managing media.

**Core principles:**

- **Dark-only.** No light theme. The entire UI lives on deep carbon surfaces.
- **Terminal-native.** Monospace type is the hero, not a novelty. Data-dense layouts feel intentional.
- **Glow as affordance.** Phosphor glow indicates interactivity and focus — it replaces the typical "primary blue" idiom.
- **Restrained palette.** Green is the only accent color. Semantic colors (red, amber, blue) appear sparingly for status.
- **Density over whitespace.** Compact spacing with clear hierarchy. Every pixel earns its place.

---

## Color Palette

### Carbon Surfaces

The background stack. Each step is a subtle lift from pure black.

| Token        | Hex       | Usage                               |
| ------------ | --------- | ----------------------------------- |
| `carbon-950` | `#08090A` | Deepest background (overlays, pits) |
| `carbon-900` | `#0D0F0E` | **Base background**                 |
| `carbon-800` | `#151917` | Card / panel surface                |
| `carbon-700` | `#1E2422` | Elevated surface, sidebar           |
| `carbon-600` | `#2A322F` | Hover states, active wells          |
| `carbon-500` | `#3B4744` | Borders, dividers                   |
| `carbon-400` | `#576462` | Muted text, placeholders            |
| `carbon-300` | `#7A8B88` | Secondary text                      |
| `carbon-200` | `#A3B0AD` | Body text                           |
| `carbon-100` | `#D0D8D6` | Headings, primary text              |
| `carbon-50`  | `#ECF0EF` | High-emphasis text                  |

### Phosphor Greens

The signature accent ramp, anchored by `terminal` (#39FF14).

| Token          | Hex       | Usage                                   |
| -------------- | --------- | --------------------------------------- |
| `phosphor-950` | `#052E05` | Darkest green (subtle tints)            |
| `phosphor-900` | `#0A4A0A` | Dark badges, dark fills                 |
| `phosphor-800` | `#0F6B0F` | Secondary green accents                 |
| `phosphor-700` | `#168F16` | Hover states on green elements          |
| `phosphor-600` | `#1FBF1F` | Active / pressed green                  |
| `phosphor-500` | `#2BDF2B` | Bright accent (charts, indicators)      |
| `terminal`     | `#39FF14` | **Primary accent** — links, focus, glow |
| `phosphor-300` | `#6FFF54` | Light accent (highlights)               |
| `phosphor-200` | `#A5FF8A` | Subtle tint on dark surfaces            |
| `phosphor-100` | `#D4FFC7` | Very light green tint                   |

### Terminal Electrics

Semantic status colors with a desaturated, terminal-appropriate feel.

| Token           | Hex       | Usage                        |
| --------------- | --------- | ---------------------------- |
| `error`         | `#FF4444` | Errors, destructive actions  |
| `error-muted`   | `#3D1515` | Error background tint        |
| `warning`       | `#FFAA22` | Warnings, caution states     |
| `warning-muted` | `#3D2E0A` | Warning background tint      |
| `info`          | `#44AAFF` | Informational, links (rare)  |
| `info-muted`    | `#0A2A3D` | Info background tint         |
| `success`       | `#39FF14` | Success — aliases `terminal` |
| `success-muted` | `#0A3D05` | Success background tint      |

### Special

| Token      | Hex                       | Usage                  |
| ---------- | ------------------------- | ---------------------- |
| `glow`     | `#39FF14`                 | Box-shadow glow color  |
| `glow-dim` | `rgba(57, 255, 20, 0.15)` | Subtle background glow |
| `scanline` | `rgba(57, 255, 20, 0.03)` | Scanline overlay       |

### Domain Color Mapping

How semantic colors map to Yoink concepts:

| Color       | Account Status | Download Status         | Storage           |
| ----------- | -------------- | ----------------------- | ----------------- |
| `terminal`  | Approved       | Downloaded, Imported    | Healthy           |
| `warning`   | Pending        | Queued, Upgrading       | Low free space    |
| `error`     | Denied         | Failed                  | Critical space    |
| `info`      | —              | Downloading, Grabbed    | —                 |
| `secondary` | —              | Missing, Not monitored  | —                 |

---

## Typography

### Font Stack

| Role       | Family             | Weight        | Usage                              |
| ---------- | ------------------ | ------------- | ---------------------------------- |
| **Mono**   | JetBrains Mono     | 400, 500, 700 | Headings, data, code, nav          |
| **Sans**   | Space Grotesk      | 400, 500, 600 | Body copy, descriptions, UI labels |
| **System** | system-ui fallback | —             | Fallback only                      |

### Loading Fonts (Next.js)

```tsx
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

// Apply to <body>:
// className={cns(jetbrainsMono.variable, spaceGrotesk.variable)}
```

### Type Scale

Built on a 1.25 ratio with monospace headings and sans body.

| Level | Class       | Size     | Line Height | Weight | Font           |
| ----- | ----------- | -------- | ----------- | ------ | -------------- |
| H1    | `text-4xl`  | 2.25rem  | 1.1         | 700    | JetBrains Mono |
| H2    | `text-3xl`  | 1.875rem | 1.15        | 700    | JetBrains Mono |
| H3    | `text-2xl`  | 1.5rem   | 1.2         | 600    | JetBrains Mono |
| H4    | `text-xl`   | 1.25rem  | 1.3         | 500    | JetBrains Mono |
| Body  | `text-base` | 1rem     | 1.6         | 400    | Space Grotesk  |
| Small | `text-sm`   | 0.875rem | 1.5         | 400    | Space Grotesk  |
| XS    | `text-xs`   | 0.75rem  | 1.4         | 400    | Space Grotesk  |
| Mono  | `font-mono` | inherit  | inherit     | 400    | JetBrains Mono |

### Usage Rules

- **Headings** always use `font-mono font-bold tracking-tight`.
- **Body text** uses `font-sans text-carbon-200 leading-relaxed`.
- **Data values** (numbers, stats, IDs) use `font-mono tabular-nums`.
- **Code** uses `font-mono text-sm` with a `phosphor-900` background.
- **Labels / UI chrome** use `font-sans text-xs font-medium uppercase tracking-wider text-carbon-300`.
- **Media metadata** (year, runtime, quality, file sizes) uses `font-mono tabular-nums text-sm text-carbon-300`.

---

## Spacing & Layout

### Base Unit

All spacing derives from a **4px base unit** via Tailwind's default scale.

| Token | Value | Usage                      |
| ----- | ----- | -------------------------- |
| `1`   | 4px   | Tight inner padding        |
| `2`   | 8px   | Icon gaps, inline spacing  |
| `3`   | 12px  | Input padding, small gaps  |
| `4`   | 16px  | Card padding, section gaps |
| `6`   | 24px  | Component spacing          |
| `8`   | 32px  | Section padding            |
| `12`  | 48px  | Page section gaps          |
| `16`  | 64px  | Major layout divisions     |

### App Shell Layout

```
┌───────────────────────────────────────────────────────────┐
│  Top Bar (h-14, carbon-800, border-b border-carbon-500)   │
│  ┌──────────┐                            ┌──────────────┐ │
│  │ Logo     │                            │ User / Admin │ │
│  └──────────┘                            └──────────────┘ │
├──────────────┬────────────────────────────────────────────┤
│ Sidebar      │  Main Content (flex-1, overflow-y-auto)    │
│ w-56         │                                            │
│ carbon-800   │  ┌──────────────────────────────────────┐  │
│              │  │  Page Content (max-w-6xl mx-auto p-6)│  │
│ ┌──────────┐ │  │                                      │  │
│ │Library   │ │  │                                      │  │
│ │Search    │ │  │                                      │  │
│ │Downloads │ │  │                                      │  │
│ │History   │ │  │                                      │  │
│ │Storage   │ │  │                                      │  │
│ └──────────┘ │  └──────────────────────────────────────┘  │
│              │                                            │
│ font-mono    │  carbon-900                                │
│ text-sm      │                                            │
├──────────────┴────────────────────────────────────────────┤
```

- **Sidebar:** Fixed `w-56` (14rem) with `carbon-800` background, `border-r border-carbon-500`
- **Top bar:** `h-14` with logo left, user menu right
- **Max content width:** `max-w-6xl` (72rem) for media grids
- **Page padding:** `p-6` on desktop, `p-4` on mobile
- **Media card grid:** `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4`
- **Auth pages** (login, pending, denied): Full-screen centered, no sidebar or top bar

---

## Component Patterns

All interactive UI components use **Material UI (MUI)**, themed via `createTheme()` in `src/theme.ts`:

- **MUI components** (`@mui/material`) for buttons, cards, chips, drawers, text fields, tooltips, skeletons, dividers
- **MUI Icons** (`@mui/icons-material`) for all icon usage
- **Tailwind CSS** for layout, spacing, custom effects (glow, scanlines), and utility styling
- **Semantic HTML** (`<header>`, `<nav>`, `<aside>`, `<main>`) for document structure
- `cns()` from `@lilnas/utils/cns` for Tailwind class merging
- `forwardRef` for ref forwarding on custom components

---

## Primitive Components

All primitives are MUI components themed via `src/theme.ts`. Use them directly from `@mui/material`.

### Button

```tsx
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'

// Primary action (terminal green, glow)
<Button variant="contained" color="primary">Download</Button>

// Secondary action (carbon border)
<Button variant="outlined" color="secondary">Sign out</Button>

// Ghost / text action
<Button variant="text">Cancel</Button>

// Icon-only
<IconButton size="small"><LogoutIcon /></IconButton>

// Destructive
<Button variant="contained" color="error">Delete</Button>
```

MUI variant mapping from old CVA variants:

| Old variant    | MUI equivalent                            |
| -------------- | ----------------------------------------- |
| `default`      | `variant="contained" color="primary"`     |
| `secondary`    | `variant="outlined" color="secondary"`    |
| `outline`      | `variant="outlined" color="primary"`      |
| `ghost`        | `variant="text"`                          |
| `destructive`  | `variant="contained" color="error"`       |
| `link`         | `variant="text" color="primary"`          |

### Card

```tsx
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'

// Default card (carbon-800 bg, carbon-500 border — via theme)
<Card>
  <CardContent>Content here</CardContent>
</Card>

// Glow variant (use sx prop)
<Card sx={{
  borderColor: 'rgba(57, 255, 20, 0.2)',
  boxShadow: '0 0 16px rgba(57, 255, 20, 0.08)',
  '&:hover': {
    boxShadow: '0 0 24px rgba(57, 255, 20, 0.15)',
    borderColor: 'rgba(57, 255, 20, 0.4)',
  },
}}>
  <CardContent>Glowing card</CardContent>
</Card>
```

### TextField

```tsx
import TextField from '@mui/material/TextField'

// Themed dark input (via theme overrides)
<TextField placeholder="Search..." fullWidth />
```

### Chip (replaces Badge)

```tsx
import Chip from '@mui/material/Chip'

// Semantic color variants (themed in src/theme.ts)
<Chip label="Downloaded" color="primary" size="small" variant="outlined" />
<Chip label="Pending" color="warning" size="small" variant="outlined" />
<Chip label="Failed" color="error" size="small" variant="outlined" />
<Chip label="Downloading" color="info" size="small" variant="outlined" />
<Chip label="Approved" color="success" size="small" variant="outlined" />
<Chip label="Missing" color="secondary" size="small" variant="outlined" />
```

| Old Badge variant | MUI Chip equivalent                    |
| ----------------- | -------------------------------------- |
| `default`         | `color="primary" variant="outlined"`   |
| `secondary`       | `color="secondary" variant="outlined"` |
| `success`         | `color="success" variant="outlined"`   |
| `error`           | `color="error" variant="outlined"`     |
| `warning`         | `color="warning" variant="outlined"`   |
| `info`            | `color="info" variant="outlined"`      |
| `outline`         | `color="secondary" variant="outlined"` |

### Progress

```tsx
import LinearProgress from '@mui/material/LinearProgress'

// Phosphor green progress bar (themed)
<LinearProgress variant="determinate" value={75} />
```

### EmptyState

Centered placeholder for views with no content (empty library, no search results, no active downloads).

```tsx
import { cns } from '@lilnas/utils/cns'
import { type HTMLAttributes, type ReactNode, forwardRef } from 'react'

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(
        'flex flex-col items-center justify-center gap-4 py-16 text-center',
        className,
      )}
      {...props}
    >
      <div className="text-carbon-400 [&_svg]:size-12">{icon}</div>
      <div className="space-y-1">
        <h3 className="font-mono text-lg font-medium text-carbon-200">
          {title}
        </h3>
        {description && (
          <p className="max-w-sm text-sm text-carbon-400">{description}</p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  ),
)

EmptyState.displayName = 'EmptyState'

export { EmptyState }
```

### FilterToggle

Three-button toggle for switching between Movies, Shows, and Both. Uses MUI `ToggleButtonGroup`.

```tsx
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'

type FilterValue = 'all' | 'movies' | 'shows'

<ToggleButtonGroup
  value={filter}
  exclusive
  onChange={(_, val) => val && setFilter(val)}
  size="small"
>
  <ToggleButton value="all">Both</ToggleButton>
  <ToggleButton value="movies">Movies</ToggleButton>
  <ToggleButton value="shows">Shows</ToggleButton>
</ToggleButtonGroup>
```

---

## Feature Components

Larger composites built from primitives above. These specs define the props interface, class compositions, and layout — implementations will evolve alongside the API data model.

### MediaCard

Poster card for the library and search grids. Displays a movie or show with its poster image, title, year, quality badge, and a status indicator dot.

```ts
interface MediaCardProps {
  title: string
  year: number
  posterUrl: string | null
  mediaType: 'movie' | 'show'
  quality?: string // e.g. "Bluray-1080p"
  status: 'downloaded' | 'downloading' | 'missing' | 'queued'
  href: string
}
```

**Layout:** Vertical card using `<Card variant="glow">`. Aspect-ratio poster (`aspect-[2/3]` with `object-cover`), bottom section with title (truncated, `font-mono text-sm text-carbon-100 line-clamp-1`), year (`font-mono tabular-nums text-xs text-carbon-400`), and a quality badge (`<Badge variant="outline" />`) when available. Status dot as a small `size-2 rounded-full` circle in the top-right corner of the poster, color-mapped per Domain Color Mapping. Hover lifts with `hover:-translate-y-0.5`. Missing poster shows a placeholder with `Film` or `Tv` icon centered on `carbon-700`.

### StatusBadge

Semantic wrapper around MUI `<Chip>` that maps account and download states to the correct color and label.

```ts
type AccountStatus = 'pending' | 'approved' | 'denied'
type DownloadStatus =
  | 'downloaded'
  | 'downloading'
  | 'queued'
  | 'missing'
  | 'failed'
  | 'importing'
  | 'upgrading'

interface StatusBadgeProps {
  status: AccountStatus | DownloadStatus
}
```

**Mapping:**

| Status        | MUI Chip Color | Label         |
| ------------- | -------------- | ------------- |
| `approved`    | `success`      | Approved      |
| `pending`     | `warning`      | Pending       |
| `denied`      | `error`        | Denied        |
| `downloaded`  | `primary`      | Downloaded    |
| `downloading` | `info`         | Downloading   |
| `queued`      | `warning`      | Queued        |
| `missing`     | `secondary`    | Missing       |
| `failed`      | `error`        | Failed        |
| `importing`   | `info`         | Importing     |
| `upgrading`   | `warning`      | Upgrading     |

### DownloadProgress

Rich progress display that composes `<Progress>` with metadata. Used in the Downloads page, Movie Detail inline, and Episode items.

```ts
interface DownloadProgressProps {
  title: string
  percent: number // 0-100
  speed?: string // e.g. "12.4 MB/s"
  eta?: string // e.g. "3m 22s"
  sizeDownloaded?: string // e.g. "1.2 GB"
  sizeTotal?: string // e.g. "4.8 GB"
  status: 'downloading' | 'queued' | 'failed'
  href?: string
}
```

**Layout:** `<Card>` container. Top row: title (`font-mono text-sm text-carbon-100 truncate`) + `<StatusBadge>`. Middle: `<Progress>` bar — `bg-info` fill for downloading, `bg-warning` for queued, `bg-error` for failed. Bottom row: stats in `font-mono tabular-nums text-xs text-carbon-400` — percent left, speed center, ETA right. Size info as `sizeDownloaded / sizeTotal`. Failed status replaces stats with error message and a retry `<Button variant="outline" size="sm">`.

### SearchBar

Terminal-styled search input with icon prefix and integrated filter toggle.

```ts
interface SearchBarProps {
  query: string
  onQueryChange: (query: string) => void
  filter: FilterValue
  onFilterChange: (filter: FilterValue) => void
  placeholder?: string
}
```

**Layout:** Full-width flex row with `bg-carbon-800 border border-carbon-500 rounded-lg`. Left: `Search` icon in `text-carbon-400 size-4 ml-3`. Center: `<Input>` unstyled (no border/bg, inherits from container). Right: `<FilterToggle>` flush inside the bar. Keyboard shortcut hint `⌘K` as `<kbd>` element, `text-carbon-500 text-xs font-mono`, positioned at far right. Focus-within on the container applies `border-terminal/60 ring-2 ring-terminal/20`.

### UserCard

Admin panel row for approving/denying user access requests.

```ts
interface UserCardProps {
  name: string
  email: string
  avatarUrl?: string
  status: AccountStatus
  requestedAt: Date
  onApprove?: () => void
  onDeny?: () => void
}
```

**Layout:** Horizontal `<Card>` with `flex items-center gap-4 p-4`. Left: avatar (`size-10 rounded-full`, fallback to initials on `bg-carbon-600`). Center: name (`font-mono text-sm text-carbon-100`), email (`text-xs text-carbon-400`), timestamp (`text-xs text-carbon-500`, relative time). Right: `<StatusBadge>` + action buttons. Pending shows `<Button size="sm">Approve</Button>` and `<Button variant="ghost" size="sm">Deny</Button>`. Approved/denied show the badge only.

### SeasonAccordion

Expandable season container for the Show Detail page. Shows season number, episode count, download summary, and expands to reveal episode items.

```ts
interface SeasonAccordionProps {
  seasonNumber: number
  episodeCount: number
  downloadedCount: number
  children: ReactNode // EpisodeItem list
  defaultOpen?: boolean
}
```

**Layout:** `<Card variant="inset">` with a clickable header row. Header: `Season {n}` in `font-mono text-sm font-medium text-carbon-100`, episode count and download summary as `text-xs text-carbon-400` (`8/10 downloaded`), `<Progress>` mini-bar (`h-1 w-20`) showing downloaded ratio, `ChevronDown` icon that rotates on open (`transition-transform duration-200`). Body: vertical stack of `<EpisodeItem>` separated by `border-t border-carbon-600`. Uses `data-[state=open]` for open/close transitions (`animate-fade-in`).

### EpisodeItem

Single episode row within a `<SeasonAccordion>`. Shows episode number, title, quality, and optional inline download progress.

```ts
interface EpisodeItemProps {
  episodeNumber: number
  title: string
  quality?: string
  status: DownloadStatus
  progress?: DownloadProgressProps
  onDownload?: () => void
  onDelete?: () => void
}
```

**Layout:** Flex row `px-4 py-3 hover:bg-carbon-700/50`. Left: episode number as `font-mono tabular-nums text-xs text-carbon-400 w-8`. Center: title (`text-sm text-carbon-200 truncate`), quality badge if present (`<Badge variant="outline" />`). Right: `<StatusBadge>` + action icon button (`<Button variant="ghost" size="icon">`). When `status === 'downloading'`, a compact `<Progress>` bar spans below the row with speed/ETA in `text-xs text-carbon-400`.

### StorageBar

Visual disk usage bar for the Storage page. Shows used vs. free space with optional breakdown by library type.

```ts
interface StorageBarProps {
  label: string // e.g. "/media/movies"
  usedBytes: number
  totalBytes: number
  moviesBytes?: number
  showsBytes?: number
  warningThreshold?: number // 0-1, default 0.9
}
```

**Layout:** Full-width card. Top: label (`font-mono text-sm text-carbon-200`) + used/total (`font-mono tabular-nums text-xs text-carbon-400`). Bar: `h-3 rounded-full bg-carbon-700 overflow-hidden`. Segmented fill — movies portion in `bg-info`, shows portion in `bg-phosphor-600`, remainder is the empty track. Below bar: legend dots with labels. When usage exceeds `warningThreshold`, bar border changes to `border-warning/40` and a warning icon appears. Above 95%, border becomes `border-error/40`.

### EventItem

Single history entry for the History page feed.

```ts
type EventType = 'grabbed' | 'imported' | 'upgraded' | 'deleted' | 'failed'

interface EventItemProps {
  eventType: EventType
  title: string
  quality?: string
  timestamp: Date
  href: string
}
```

**Layout:** Flex row `py-3 border-b border-carbon-600/50 hover:bg-carbon-700/30`. Left: event type icon (`size-4`) — `Download` for grabbed, `CheckCircle` for imported, `ArrowUpCircle` for upgraded, `Trash2` for deleted, `XCircle` for failed. Color matches event type (info for grabbed/downloading, terminal for imported, warning for upgraded, error for deleted/failed). Center: title (`font-mono text-sm text-carbon-100 truncate`), quality badge. Right: relative timestamp (`text-xs text-carbon-400`). Entire row is a link to the detail page.

### ActionMenu

Pattern for download/delete/re-download actions on detail pages (Movie Detail, Show Detail).

```ts
interface ActionMenuProps {
  status: DownloadStatus
  onDownload?: () => void
  onDelete?: () => void
  onRedownload?: () => void
}
```

**Patterns:**
- **Missing:** Single `<Button>` with `Download` icon — `variant="default"`.
- **Downloaded:** `<Button variant="secondary">` with `Trash2` icon for delete + `<Button variant="outline">` with `RefreshCw` icon for re-download.
- **Downloading/Queued:** `<Button variant="ghost" disabled>` showing status text.
- **Failed:** `<Button variant="outline">` with `RefreshCw` icon for retry + error `text-xs text-error` message.

All destructive actions should trigger a confirmation dialog before executing.

---

## Page Layouts

Wireframe compositions describing what components go where for each major view.

### Login

Full-screen centered layout, no sidebar or top bar.

```
┌───────────────────────────────────┐
│                                   │
│         ┌─────────────┐           │
│         │  Logo/Title  │           │
│         │  "yoink"     │           │
│         │              │           │
│         │ [Google SSO] │           │
│         └─────────────┘           │
│                                   │
│         bg-carbon-950             │
│         scanlines overlay         │
└───────────────────────────────────┘
```

- Background: `bg-carbon-950` full viewport with `scanlines` overlay
- Centered container: `max-w-sm` card with `border-terminal/20 glow-sm`
- Logo: `font-mono text-3xl font-bold text-terminal text-glow`
- Subtitle: `font-sans text-sm text-carbon-400`
- Google button: `<Button variant="secondary" size="lg">` with Google icon

### Pending State

Full-screen centered, shown after first-time sign-in before admin approval.

```
┌───────────────────────────────────┐
│                                   │
│        ┌──────────────┐           │
│        │ Clock icon   │           │
│        │              │           │
│        │ "Pending     │           │
│        │  Approval"   │           │
│        │              │           │
│        │ Description  │           │
│        └──────────────┘           │
│                                   │
└───────────────────────────────────┘
```

- Uses `<EmptyState>` pattern with `Clock` icon in `text-warning`
- Title: "Pending Approval"
- Description explains admin needs to approve, check back later
- `<StatusBadge status="pending" />` below title

### Denied State

Full-screen centered, shown when admin has denied the access request.

- Uses `<EmptyState>` pattern with `ShieldX` icon in `text-error`
- Title: "Access Denied"
- Description explains the request was denied
- Action: `<Button variant="outline">Re-request Access</Button>` to move back to pending

### App Shell

Wraps all authenticated pages (Library, Search, Downloads, History, Storage, Admin).

- Layout: See **App Shell Layout** diagram in Spacing & Layout section
- Sidebar nav items: `Library`, `Search`, `Downloads`, `History`, `Storage` — each with icon + label
- Active nav item: `bg-terminal/10 text-terminal border-l-2 border-terminal`
- Inactive: `text-carbon-400 hover:text-carbon-200 hover:bg-carbon-700/50`
- Admin link only visible for admin users, separated by a `border-t border-carbon-600` divider
- Top bar right: user avatar + name, sign-out button

### Library

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ H2: "Library"      [FilterToggle]    │ │
│ │                                      │ │
│ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │ │
│ │ │Media ││Media ││Media ││Media │ │ │
│ │ │Card  ││Card  ││Card  ││Card  │ │ │
│ │ │      ││      ││      ││      │ │ │
│ │ └──────┘ └──────┘ └──────┘ └──────┘ │ │
│ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │ │
│ │ │ ...  ││ ...  ││ ...  ││ ...  │ │ │
│ │ └──────┘ └──────┘ └──────┘ └──────┘ │ │
│ │                                      │ │
│ │ (or <EmptyState> if no downloads)    │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Header row: `flex items-center justify-between` with page title and `<FilterToggle>`
- Grid: responsive `<MediaCard>` grid per Spacing & Layout
- Empty state: `<EmptyState icon={<Film />} title="No downloads yet" description="Search for movies and shows to get started." action={<Button asChild><Link href="/search">Browse</Link></Button>} />`

### Search

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ [SearchBar with FilterToggle]        │ │
│ │                                      │ │
│ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │ │
│ │ │Media ││Media ││Media ││Media │ │ │
│ │ │Card  ││Card  ││Card  ││Card  │ │ │
│ │ └──────┘ └──────┘ └──────┘ └──────┘ │ │
│ │                                      │ │
│ │ (or <EmptyState> when no results)    │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- `<SearchBar>` at top, sticky below top bar (`sticky top-14 z-10 bg-carbon-900/95 backdrop-blur`)
- Results in same `<MediaCard>` grid
- Initial state before typing: `<EmptyState icon={<Search />} title="Search for media" description="Find movies and shows to add to your library." />`
- No results: `<EmptyState icon={<SearchX />} title="No results" description="Try a different search term." />`

### Movie Detail

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ ┌────────┐  Title (H1)              │ │
│ │ │Poster  │  Year · Runtime · Rating  │ │
│ │ │        │  [Quality Badge]          │ │
│ │ │        │  Overview paragraph       │ │
│ │ │        │                           │ │
│ │ │        │  [ActionMenu]             │ │
│ │ └────────┘                           │ │
│ │                                      │ │
│ │ ┌──── Download Progress (if any) ──┐ │ │
│ │ │ <DownloadProgress>               │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ Files                                │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ filename.mkv  4.2 GB  1080p     │ │ │
│ │ └──────────────────────────────────┘ │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Top section: poster (`w-48 aspect-[2/3] rounded-lg`) left, metadata right
- Title: `font-mono text-3xl font-bold text-carbon-50`
- Metadata row: `font-mono tabular-nums text-sm text-carbon-300` with `·` separators
- Overview: `font-sans text-carbon-200 leading-relaxed max-w-prose`
- `<ActionMenu>` below overview
- `<DownloadProgress>` shown inline when actively downloading
- Files section: `<Card variant="inset">` table with filename, size, quality columns

### Show Detail

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ ┌────────┐  Title (H1)              │ │
│ │ │Poster  │  Year · Seasons · Rating  │ │
│ │ │        │  [StatusBadge]            │ │
│ │ │        │  Overview paragraph       │ │
│ │ │        │                           │ │
│ │ │        │  [ActionMenu (series)]    │ │
│ │ └────────┘                           │ │
│ │                                      │ │
│ │ ┌──── Season 1 ───── 10/10 ── ▸ ──┐ │ │
│ │ │ <SeasonAccordion>                │ │ │
│ │ │   <EpisodeItem />                │ │ │
│ │ │   <EpisodeItem />                │ │ │
│ │ │   ...                            │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │ ┌──── Season 2 ───── 8/12 ── ▾ ──┐ │ │
│ │ │ (collapsed)                      │ │ │
│ │ └──────────────────────────────────┘ │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Same top section as Movie Detail with show-specific metadata
- Below: vertical stack of `<SeasonAccordion>` components, each containing `<EpisodeItem>` rows
- `<ActionMenu>` available at series level (top) and individual episode level (inside each row)

### Downloads

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ H2: "Downloads"                      │ │
│ │                                      │ │
│ │ Active                               │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ <DownloadProgress status="dl">  │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ <DownloadProgress status="dl">  │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ Queued                               │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ <DownloadProgress status="q">   │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ Failed                               │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ <DownloadProgress status="fail">│ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ (or <EmptyState> when nothing)       │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Three sections: "Active", "Queued", "Failed" — each a labeled group with `H3` heading and count badge
- Each item is a `<DownloadProgress>` card, clickable to navigate to the detail page
- Sections only render when they have items
- Empty state: `<EmptyState icon={<Download />} title="No active downloads" description="Everything is up to date." />`

### History

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ H2: "History"     [FilterToggle]     │ │
│ │ [Event type filter chips]            │ │
│ │                                      │ │
│ │ <EventItem />                        │ │
│ │ <EventItem />                        │ │
│ │ <EventItem />                        │ │
│ │ <EventItem />                        │ │
│ │ ...                                  │ │
│ │                                      │ │
│ │ (loads more on scroll)               │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Header row: title + `<FilterToggle>` for movies/shows
- Below header: horizontal row of event type filter chips (`grabbed`, `imported`, `upgraded`, `deleted`, `failed`) using `<Badge>` as toggleable buttons
- Feed: vertical list of `<EventItem>` components
- Infinite scroll: loads next page when scrolling near bottom
- Empty state: `<EmptyState icon={<History />} title="No history yet" description="Events will appear here as downloads complete." />`

### Storage

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ H2: "Storage"                        │ │
│ │                                      │ │
│ │ ┌──── Warning Banner (if low) ─────┐ │ │
│ │ │ ⚠ Low disk space on /media       │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ ┌──── <StorageBar> /media/movies ──┐ │ │
│ │ └──────────────────────────────────┘ │ │
│ │ ┌──── <StorageBar> /media/shows ───┐ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ Largest Items                        │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ title        size   quality      │ │ │
│ │ │ title        size   quality      │ │ │
│ │ │ ...                              │ │ │
│ │ └──────────────────────────────────┘ │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Warning banner: `<Card>` with `bg-warning-muted border-warning/30` when any root folder exceeds threshold — `AlertTriangle` icon + message
- `<StorageBar>` for each root folder
- "Largest Items" table in `<Card variant="inset">` — columns: title (linked), file size (`font-mono tabular-nums`), quality badge. Sorted by size descending. Top 20 items.

### Admin

```
┌──────────────────────────────────────────┐
│ App Shell                                │
│ ┌──────────────────────────────────────┐ │
│ │ H2: "Admin"                          │ │
│ │                                      │ │
│ │ Pending Requests (count)             │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ <UserCard status="pending" />    │ │ │
│ │ │ <UserCard status="pending" />    │ │ │
│ │ └──────────────────────────────────┘ │ │
│ │                                      │ │
│ │ Approved Users (count)               │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ <UserCard status="approved" />   │ │ │
│ │ │ <UserCard status="approved" />   │ │ │
│ │ └──────────────────────────────────┘ │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Two sections: "Pending Requests" and "Approved Users", each with count badge
- `<UserCard>` rows with approve/deny actions for pending, badge-only for approved
- Empty pending: `<EmptyState icon={<UserCheck />} title="No pending requests" description="All access requests have been handled." />`

---

## Animation & Motion

### Keyframes

| Name             | Description                            | Duration | Usage                        |
| ---------------- | -------------------------------------- | -------- | ---------------------------- |
| `glow-pulse`     | Pulsing green box-shadow               | 2s       | Active states, notifications |
| `terminal-blink` | Cursor-style opacity blink             | 1s       | Cursor indicator, loading    |
| `fade-in`        | Opacity 0 -> 1 with slight Y translate | 300ms    | Content entrance             |
| `slide-in-right` | Translate-X entrance from the right    | 200ms    | Sidebar panels, drawers      |

### Easing

| Token       | Value                           | Usage                 |
| ----------- | ------------------------------- | --------------------- |
| `ease-out`  | `cubic-bezier(0.16, 1, 0.3, 1)` | Default for entrances |
| `ease-in`   | `cubic-bezier(0.7, 0, 0.84, 0)` | Exit animations       |
| `ease-glow` | `cubic-bezier(0.4, 0, 0.2, 1)`  | Glow transitions      |

### Domain Motion Patterns

- **Download progress bars** transition width with `duration-500 ease-out` for smooth percent updates. Avoid per-frame jank by debouncing updates to ~1s intervals.
- **Download queue entrance** uses `animate-fade-in` when new items appear. Completed items fade out with `opacity-0 transition-opacity duration-300` before removal.
- **Media card grids** stagger entrance with incremental `animation-delay` (e.g. `style={{ animationDelay: '${index * 50}ms' }}`) using `animate-fade-in`.
- **Season accordion** expand/collapse uses `grid-rows-[0fr]` to `grid-rows-[1fr]` with `transition-[grid-template-rows] duration-200` for smooth height animation.
- **Search results** fade in as a group with `animate-fade-in` on the container, not individual cards.

### Reduced Motion

All animations are disabled under `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Custom Utilities

Defined as Tailwind `@utility` directives in `src/tailwind.css`.

| Class          | Effect                                             |
| -------------- | -------------------------------------------------- |
| `glow-sm`      | `box-shadow: 0 0 8px rgba(57, 255, 20, 0.2)`       |
| `glow-md`      | `box-shadow: 0 0 16px rgba(57, 255, 20, 0.3)`      |
| `glow-lg`      | `box-shadow: 0 0 32px rgba(57, 255, 20, 0.4)`      |
| `text-glow`    | `text-shadow: 0 0 8px rgba(57, 255, 20, 0.6)`      |
| `text-glow-sm` | `text-shadow: 0 0 4px rgba(57, 255, 20, 0.4)`      |
| `scanlines`    | Repeating-gradient overlay for CRT scanline effect |
| `cursor-blink` | Applies `terminal-blink` animation                 |

---

## Tailwind CSS Configuration

All design tokens are defined in `src/tailwind.css` using Tailwind v4's CSS-first `@theme` directive. The `tailwind.config.ts` file remains minimal — only `content` paths.

### Full `src/tailwind.css`

```css
@import 'tailwindcss';

@theme {
  /* ── Fonts ── */
  --font-mono:
    'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  --font-sans: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;

  /* ── Carbon Surfaces ── */
  --color-carbon-950: #08090a;
  --color-carbon-900: #0d0f0e;
  --color-carbon-800: #151917;
  --color-carbon-700: #1e2422;
  --color-carbon-600: #2a322f;
  --color-carbon-500: #3b4744;
  --color-carbon-400: #576462;
  --color-carbon-300: #7a8b88;
  --color-carbon-200: #a3b0ad;
  --color-carbon-100: #d0d8d6;
  --color-carbon-50: #ecf0ef;

  /* ── Phosphor Greens ── */
  --color-phosphor-950: #052e05;
  --color-phosphor-900: #0a4a0a;
  --color-phosphor-800: #0f6b0f;
  --color-phosphor-700: #168f16;
  --color-phosphor-600: #1fbf1f;
  --color-phosphor-500: #2bdf2b;
  --color-terminal: #39ff14;
  --color-phosphor-300: #6fff54;
  --color-phosphor-200: #a5ff8a;
  --color-phosphor-100: #d4ffc7;

  /* ── Semantic Colors ── */
  --color-error: #ff4444;
  --color-error-muted: #3d1515;
  --color-warning: #ffaa22;
  --color-warning-muted: #3d2e0a;
  --color-info: #44aaff;
  --color-info-muted: #0a2a3d;
  --color-success: #39ff14;
  --color-success-muted: #0a3d05;

  /* ── Animations ── */
  --animate-glow-pulse: glow-pulse 2s ease-in-out infinite;
  --animate-terminal-blink: terminal-blink 1s step-end infinite;
  --animate-fade-in: fade-in 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  --animate-slide-in-right: slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)
    forwards;
}

/* ── Keyframes ── */

@keyframes glow-pulse {
  0%,
  100% {
    box-shadow: 0 0 8px rgba(57, 255, 20, 0.2);
  }
  50% {
    box-shadow: 0 0 20px rgba(57, 255, 20, 0.5);
  }
}

@keyframes terminal-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* ── Custom Utilities ── */

@utility glow-sm {
  box-shadow: 0 0 8px rgba(57, 255, 20, 0.2);
}

@utility glow-md {
  box-shadow: 0 0 16px rgba(57, 255, 20, 0.3);
}

@utility glow-lg {
  box-shadow: 0 0 32px rgba(57, 255, 20, 0.4);
}

@utility text-glow {
  text-shadow: 0 0 8px rgba(57, 255, 20, 0.6);
}

@utility text-glow-sm {
  text-shadow: 0 0 4px rgba(57, 255, 20, 0.4);
}

@utility scanlines {
  background-image: repeating-linear-gradient(
    0deg,
    rgba(57, 255, 20, 0.03) 0px,
    rgba(57, 255, 20, 0.03) 1px,
    transparent 1px,
    transparent 3px
  );
}

@utility cursor-blink {
  animation: terminal-blink 1s step-end infinite;
}

/* ── Base Layer ── */

@layer base {
  html {
    color-scheme: dark;
  }

  body {
    @apply bg-carbon-900 font-sans text-carbon-200 antialiased;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    @apply font-mono font-bold tracking-tight text-carbon-50;
  }

  ::selection {
    background-color: rgba(57, 255, 20, 0.25);
    color: #ecf0ef;
  }

  /* Scrollbar styling */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: #0d0f0e;
  }

  ::-webkit-scrollbar-thumb {
    background: #3b4744;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #576462;
  }
}
```

---

## Accessibility

### Contrast Ratios

All text/background combinations meet WCAG AA (4.5:1 for normal text, 3:1 for large text).

| Foreground   | Background      | Ratio  | Level |
| ------------ | --------------- | ------ | ----- |
| `carbon-50`  | `carbon-900`    | 14.8:1 | AAA   |
| `carbon-100` | `carbon-900`    | 11.6:1 | AAA   |
| `carbon-200` | `carbon-900`    | 8.1:1  | AAA   |
| `carbon-300` | `carbon-900`    | 5.2:1  | AA    |
| `terminal`   | `carbon-900`    | 12.5:1 | AAA   |
| `terminal`   | `carbon-950`    | 13.4:1 | AAA   |
| `carbon-950` | `terminal`      | 13.4:1 | AAA   |
| `error`      | `error-muted`   | 5.8:1  | AA    |
| `warning`    | `warning-muted` | 7.2:1  | AA    |
| `info`       | `info-muted`    | 5.5:1  | AA    |

### Focus Indicators

- All interactive elements use `focus-visible:ring-2 focus-visible:ring-terminal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-carbon-900`.
- Focus rings are clearly visible against all surface colors.
- Keyboard navigation follows logical tab order.

### Reduced Motion

- All animations respect `prefers-reduced-motion: reduce`.
- Glow effects remain static (no pulsing) under reduced motion.
- Transitions reduce to near-instant (`0.01ms`) under reduced motion.

### Color Independence

- Status is never communicated through color alone — icons and text labels always accompany colored badges.
- The terminal green accent is supplemented by shape and position cues for interactive affordances.

---

## Icons

Use [MUI Icons](https://mui.com/material-ui/material-icons/) (`@mui/icons-material`). Icons should be `20px` (default `fontSize="small"`) in UI chrome and `24px` (default) in feature areas.

### Icon Mapping

| Concept         | MUI Icon          | Usage                                |
| --------------- | ----------------- | ------------------------------------ |
| Movies          | `Movie`           | Sidebar nav, filter toggle, cards    |
| Shows           | `Tv`              | Sidebar nav, filter toggle, cards    |
| Downloads       | `Download`        | Sidebar nav, download actions        |
| Storage         | `Storage`         | Sidebar nav, storage page            |
| History         | `History`         | Sidebar nav, history page            |
| Search          | `Search`          | Sidebar nav, search bar              |
| Library         | `GridView`        | Sidebar nav                          |
| Admin           | `Shield`          | Sidebar nav (admin only)             |
| Approve         | `PersonAdd`       | Admin approve action                 |
| Deny            | `PersonRemove`    | Admin deny action                    |
| Delete          | `Delete`          | Destructive delete actions           |
| Re-download     | `Refresh`         | Re-download / retry actions          |
| Failed          | `Cancel`          | Failed download indicator            |
| Imported        | `CheckCircle`     | Imported/completed event             |
| Upgraded        | `ArrowCircleUp`   | Upgrade event                        |
| Grabbed         | `Download`        | Grabbed event                        |
| Warning         | `Warning`         | Low storage, warnings                |
| Expand/Collapse | `ExpandMore`      | Season accordion toggle              |
| Sign out        | `Logout`          | User menu sign out                   |
| Pending         | `Schedule`        | Pending approval state               |
| Denied          | `GppBad`          | Access denied state                  |
| Menu            | `Menu`            | Mobile sidebar toggle                |
| Close           | `Close`           | Drawer / dialog close                |

```tsx
import DownloadIcon from '@mui/icons-material/Download'
import GridViewIcon from '@mui/icons-material/GridView'
import StorageIcon from '@mui/icons-material/Storage'

// Default size in nav (small)
<GridViewIcon fontSize="small" className="text-terminal" />

// Feature/hero size (default 24px)
<DownloadIcon className="text-terminal" />

// Status indicator with semantic color
<CancelIcon fontSize="small" className="text-error" />
```
