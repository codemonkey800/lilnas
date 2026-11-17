import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode, SVGProps } from 'react'

/**
 * Icons are inline SVG, stroked in `currentColor`. The set is the union of
 * the three hand-rolled ones the apps grew — `auth`'s 20×20 set, `download`'s
 * 16×16 sprite and `dev`'s additions — de-duplicated by meaning
 * (`arrowRight` → `arrow`, `chevronDown` → `chevron`), plus `menu`.
 *
 * Every icon is drawn on a 16 or 20 unit grid. `Icon` scales the stroke with
 * the grid so a 20-grid icon and a 16-grid icon read at the same weight.
 */
type IconDef = {
  /** Omitted means the 16-unit grid. */
  grid?: 20
  body: ReactNode
}

const ICONS = {
  // ── 16 grid ────────────────────────────────────────────────────────────
  activity: { body: <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" /> },
  alert: {
    body: (
      <>
        <circle cx="8" cy="8" r="6.3" />
        <path d="M8 5v4" />
        <circle cx="8" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
      </>
    ),
  },
  arrow: { body: <path d="M3 8h10m0 0-4-4m4 4-4 4" /> },
  check: { body: <path d="m3 8.5 3.5 3.5L13 4.5" /> },
  chevron: { body: <path d="M4 6l4 4 4-4" /> },
  clock: {
    body: (
      <>
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 4.6V8l2.2 1.4" />
      </>
    ),
  },
  device: {
    body: (
      <>
        <rect x="4.5" y="1.5" width="7" height="13" rx="1.6" />
        <path d="M7 12.6h2" />
      </>
    ),
  },
  download: { body: <path d="M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13h10" /> },
  expand: { body: <path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" /> },
  external: {
    body: (
      <>
        <path d="M6.5 3H3.6c-.6 0-1.1.5-1.1 1.1v8.3c0 .6.5 1.1 1.1 1.1h8.3c.6 0 1.1-.5 1.1-1.1V9.5" />
        <path d="M9 3h4v4M12.7 3.3 7.3 8.7" />
      </>
    ),
  },
  eye: {
    body: (
      <>
        <path d="M1.3 8S3.9 3.7 8 3.7 14.7 8 14.7 8 12.1 12.3 8 12.3 1.3 8 1.3 8Z" />
        <circle cx="8" cy="8" r="2" />
      </>
    ),
  },
  'eye-slash': {
    body: (
      <>
        <path d="M1.3 8S3.9 3.7 8 3.7 14.7 8 14.7 8 12.1 12.3 8 12.3 1.3 8 1.3 8Z" />
        <path d="M2 2l12 12" />
      </>
    ),
  },
  file: {
    body: (
      <>
        <path d="M4 1.9h5l3.2 3.2V13a1.1 1.1 0 0 1-1.1 1.1H4A1.1 1.1 0 0 1 2.9 13V3A1.1 1.1 0 0 1 4 1.9z" />
        <path d="M9 1.9v3.4h3.2" />
      </>
    ),
  },
  film: {
    body: (
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M5.5 3v10M10.5 3v10" />
      </>
    ),
  },
  filter: { body: <path d="M2.5 4h11M4.5 8h7M6.5 12h3" /> },
  flag: { body: <path d="M3.5 1.5v13M3.5 2.5h8l-2 3 2 3h-8" /> },
  grid: {
    body: (
      <>
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </>
    ),
  },
  'grid-fill': {
    body: (
      <g fill="currentColor" stroke="none">
        <rect x="2" y="2" width="5" height="5" rx="1.2" />
        <rect x="9" y="2" width="5" height="5" rx="1.2" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" />
      </g>
    ),
  },
  layers: {
    body: (
      <>
        <path d="M8 2 14 5 8 8 2 5 8 2Z" />
        <path d="M2 8l6 3 6-3M2 11l6 3 6-3" />
      </>
    ),
  },
  list: { body: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" /> },
  lock: {
    body: (
      <>
        <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" />
        <path d="M5.4 7V5a2.6 2.6 0 0 1 5.2 0v2" />
      </>
    ),
  },
  menu: { body: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /> },
  pause: { body: <path d="M5 3.5v9M11 3.5v9" /> },
  play: {
    body: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  },
  recreate: {
    body: (
      <>
        <path d="M8 2.2 13.4 5v6L8 13.8 2.6 11V5z" />
        <path d="M2.8 5.1 8 8l5.2-2.9M8 8v5.6" />
      </>
    ),
  },
  refresh: { body: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6v2.7h-2.7" /> },
  search: {
    body: (
      <>
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 14 14" />
      </>
    ),
  },
  shield: {
    body: (
      <path d="M8 1.5l5.5 2v4c0 4-2.5 6.2-5.5 7-3-.8-5.5-3-5.5-7v-4l5.5-2Z" />
    ),
  },
  sort: { body: <path d="M3.2 6.4l4.8-4.8 4.8 4.8M3.2 9.6l4.8 4.8 4.8-4.8" /> },
  stop: {
    body: (
      <rect
        x="4"
        y="4"
        width="8"
        height="8"
        rx="1.6"
        fill="currentColor"
        stroke="none"
      />
    ),
  },
  terminal: {
    body: (
      <>
        <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" />
        <path d="m4.8 6.2 2.2 1.8-2.2 1.8M8.6 10h2.8" />
      </>
    ),
  },
  trash: {
    body: (
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4.5" />
    ),
  },
  tv: {
    body: (
      <>
        <rect x="1.5" y="3" width="13" height="9" rx="1.4" />
        <path d="M6 14.5h4" />
      </>
    ),
  },
  volume: {
    body: (
      <>
        <path d="M2 6.1h2.3L8 3.3v9.4L4.3 9.9H2Z" />
        <path d="M10.4 5.9a3.1 3.1 0 0 1 0 4.2M12.2 4a5.7 5.7 0 0 1 0 8" />
      </>
    ),
  },
  x: { body: <path d="M4 4l8 8M12 4l-8 8" /> },

  // ── 20 grid (from auth) ────────────────────────────────────────────────
  chart: {
    grid: 20,
    body: (
      <>
        <path d="M4 16V9M9.5 16V4M15 16v-6" />
        <path d="M2.5 16.5h15" />
      </>
    ),
  },
  folder: {
    grid: 20,
    body: (
      <path d="M2.5 5.5A1 1 0 0 1 3.5 4.5H7l1.5 2H16.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-9Z" />
    ),
  },
  globe: {
    grid: 20,
    body: (
      <>
        <circle cx="10" cy="10" r="7.5" />
        <path d="M2.5 10h15M10 2.5c1.8 2 2.8 4.8 2.8 7.5s-1 5.5-2.8 7.5c-1.8-2-2.8-4.8-2.8-7.5S8.2 4.5 10 2.5Z" />
      </>
    ),
  },
  google: {
    grid: 20,
    body: (
      <g fill="currentColor" stroke="none">
        <path d="M17.5 10.2c0-.6-.05-1.17-.15-1.7H10v3.4h4.2c-.18 1-.75 1.85-1.6 2.42v2h2.3c1.35-1.24 2.1-3.08 2.1-6.12Z" />
        <path d="M10 17.5c2.1 0 3.86-.7 5.15-1.9l-2.3-2c-.65.45-1.5.7-2.85.7-2.2 0-4.05-1.48-4.7-3.48H2.9v2.06A7.5 7.5 0 0 0 10 17.5Z" />
        <path d="M5.3 10.82a4.6 4.6 0 0 1 0-2.94V5.82H2.9a7.5 7.5 0 0 0 0 6.76l2.4-1.76Z" />
        <path d="M10 6.4c1.14 0 2.16.4 2.97 1.16l2.05-2C13.86 4.4 12.1 3.7 10 3.7A7.5 7.5 0 0 0 2.9 8.06l2.4 1.76C5.95 7.88 7.8 6.4 10 6.4Z" />
      </g>
    ),
  },
  home: {
    grid: 20,
    body: (
      <>
        <path d="M3 9.5 10 3l7 6.5" />
        <path d="M5 8v8h10V8" />
      </>
    ),
  },
  inbox: {
    grid: 20,
    body: (
      <>
        <path d="M3 11 5.5 4h9L17 11" />
        <path d="M3 11v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4h-4.2a2.8 2.8 0 0 1-5.6 0H3Z" />
      </>
    ),
  },
  key: {
    grid: 20,
    body: (
      <>
        <circle cx="7" cy="13" r="3.5" />
        <path d="M9.5 10.5 16 4M13.5 6.5 16 4M15 8l1.5-1.5" />
      </>
    ),
  },
  laptop: {
    grid: 20,
    body: (
      <>
        <rect x="3" y="4" width="14" height="9" rx="1.2" />
        <path d="M2 16.5h16" />
      </>
    ),
  },
  logout: {
    grid: 20,
    body: (
      <>
        <path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" />
        <path d="M13 6.5 17 10l-4 3.5M17 10H7.5" />
      </>
    ),
  },
  mail: {
    grid: 20,
    body: (
      <>
        <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
        <path d="M3 5.5 10 11l7-5.5" />
      </>
    ),
  },
  monitor: {
    grid: 20,
    body: (
      <>
        <rect x="2.5" y="4" width="15" height="10" rx="1.2" />
        <path d="M7 17h6M10 14v3" />
      </>
    ),
  },
  plus: { grid: 20, body: <path d="M10 4v12M4 10h12" /> },
  server: {
    grid: 20,
    body: (
      <>
        <rect x="3" y="3.5" width="14" height="5" rx="1.2" />
        <rect x="3" y="11.5" width="14" height="5" rx="1.2" />
        <path d="M6 6h.01M6 14h.01" />
      </>
    ),
  },
  users: {
    grid: 20,
    body: (
      <>
        <circle cx="7" cy="6.5" r="2.5" />
        <path d="M2 16v-.5A4.5 4.5 0 0 1 6.5 11h1A4.5 4.5 0 0 1 12 15.5V16" />
        <circle cx="14.5" cy="7.5" r="2" />
        <path d="M14 11a3.5 3.5 0 0 1 3.5 3.5v.5" />
      </>
    ),
  },
} satisfies Record<string, IconDef>

export type IconName = keyof typeof ICONS

export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[]

/** Stroke width in px at the 16 grid; the 20 grid scales to match. */
const STROKE = 1.6

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName
  /** Rendered width and height in px. */
  size?: number
}

/**
 * Decorative (`aria-hidden`) unless an `aria-label` is given, in which case it
 * is announced as an image. Colour comes from `currentColor`.
 */
export function Icon({
  name,
  size = 16,
  className,
  ...svg
}: IconProps): JSX.Element {
  const { grid = 16, body } = ICONS[name] as IconDef
  const labelled = Boolean(svg['aria-label'])

  return (
    <svg
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      focusable="false"
      {...svg}
      className={cns('shrink-0', className)}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={(STROKE * grid) / 16}
      viewBox={`0 0 ${grid} ${grid}`}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {body}
    </svg>
  )
}
