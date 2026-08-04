import type { ReactNode } from 'react'

// Ported from the design mockups' assets/services.js `ICONS` map as real
// JSX <path> elements — not dangerouslySetInnerHTML — so these render
// through React's normal reconciliation like any other component.
export type IconName =
  | 'shield'
  | 'clock'
  | 'check'
  | 'x'
  | 'folder'
  | 'film'
  | 'tv'
  | 'search'
  | 'inbox'
  | 'play'
  | 'home'
  | 'chart'
  | 'server'
  | 'mail'
  | 'plus'
  | 'chevronDown'
  | 'logout'
  | 'refresh'
  | 'users'
  | 'globe'
  | 'arrowRight'
  | 'laptop'
  | 'monitor'
  | 'key'
  | 'google'

const ICON_PATHS: Record<IconName, ReactNode> = {
  shield: (
    <>
      <path
        d="M10 2 3 5v5c0 4.2 3 7 7 9 4-2 7-4.8 7-9V5l-7-3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 10.2 9 12l4-4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  check: (
    <path d="M4 10.5 8 14l8-8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  x: <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />,
  folder: (
    <path
      d="M2.5 5.5A1 1 0 0 1 3.5 4.5H7l1.5 2H16.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-9Z"
      strokeLinejoin="round"
    />
  ),
  film: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M2.5 7.5h15M2.5 12.5h15M7 3.5v13M13 3.5v13" />
    </>
  ),
  tv: (
    <>
      <rect x="2.5" y="4.5" width="15" height="10" rx="1.5" />
      <path d="M7 17.5h6" strokeLinecap="round" />
    </>
  ),
  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5 13 13" strokeLinecap="round" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 11 5.5 4h9L17 11" strokeLinejoin="round" />
      <path
        d="M3 11v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4h-4.2a2.8 2.8 0 0 1-5.6 0H3Z"
        strokeLinejoin="round"
      />
    </>
  ),
  play: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8.3 7.2 12.8 10l-4.5 2.8V7.2Z" strokeLinejoin="round" />
    </>
  ),
  home: (
    <>
      <path
        d="M3 9.5 10 3l7 6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 8v8h10V8" strokeLinejoin="round" />
    </>
  ),
  chart: (
    <>
      <path d="M4 16V9M9.5 16V4M15 16v-6" strokeLinecap="round" />
      <path d="M2.5 16.5h15" strokeLinecap="round" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3.5" width="14" height="5" rx="1.2" />
      <rect x="3" y="11.5" width="14" height="5" rx="1.2" />
      <path d="M6 6h.01M6 14h.01" strokeLinecap="round" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path
        d="M3 5.5 10 11l7-5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" strokeLinecap="round" />,
  chevronDown: (
    <path
      d="M5 7.5 10 12.5 15 7.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  logout: (
    <>
      <path
        d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 6.5 17 10l-4 3.5M17 10H7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  refresh: (
    <path
      d="M16 6.5V3m0 3.5H12.5M16 6.5A6.5 6.5 0 1 0 17 10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  users: (
    <>
      <circle cx="7" cy="6.5" r="2.5" />
      <path
        d="M2 16v-.5A4.5 4.5 0 0 1 6.5 11h1A4.5 4.5 0 0 1 12 15.5V16"
        strokeLinecap="round"
      />
      <circle cx="14.5" cy="7.5" r="2" />
      <path d="M14 11a3.5 3.5 0 0 1 3.5 3.5v.5" strokeLinecap="round" />
    </>
  ),
  globe: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path
        d="M2.5 10h15M10 2.5c1.8 2 2.8 4.8 2.8 7.5s-1 5.5-2.8 7.5c-1.8-2-2.8-4.8-2.8-7.5S8.2 4.5 10 2.5Z"
        strokeLinejoin="round"
      />
    </>
  ),
  arrowRight: (
    <path
      d="M4 10h12M11 5l5 5-5 5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  laptop: (
    <>
      <rect x="3" y="4" width="14" height="9" rx="1.2" />
      <path d="M2 16.5h16" strokeLinecap="round" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="4" width="15" height="10" rx="1.2" />
      <path d="M7 17h6M10 14v3" strokeLinecap="round" />
    </>
  ),
  key: (
    <>
      <circle cx="7" cy="13" r="3.5" />
      <path
        d="M9.5 10.5 16 4M13.5 6.5 16 4M15 8l1.5-1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  google: (
    <>
      <path
        d="M17.5 10.2c0-.6-.05-1.17-.15-1.7H10v3.4h4.2c-.18 1-.75 1.85-1.6 2.42v2h2.3c1.35-1.24 2.1-3.08 2.1-6.12Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M10 17.5c2.1 0 3.86-.7 5.15-1.9l-2.3-2c-.65.45-1.5.7-2.85.7-2.2 0-4.05-1.48-4.7-3.48H2.9v2.06A7.5 7.5 0 0 0 10 17.5Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M5.3 10.82a4.6 4.6 0 0 1 0-2.94V5.82H2.9a7.5 7.5 0 0 0 0 6.76l2.4-1.76Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M10 6.4c1.14 0 2.16.4 2.97 1.16l2.05-2C13.86 4.4 12.1 3.7 10 3.7A7.5 7.5 0 0 0 2.9 8.06l2.4 1.76C5.95 7.88 7.8 6.4 10 6.4Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
}

export type IconProps = {
  name: IconName
  className?: string
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}
