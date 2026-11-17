// Copy and sample data for index.pug. Colour swatches carry the Tailwind class
// that paints them, so the page uses the real tokens rather than restating hex.

export const jump = [
  ['Foundations', 'foundations'],
  ['Doorplate', 'doorplate'],
  ['App bar', 'app-bar'],
  ['Button', 'button'],
  ['Badge', 'badge'],
  ['Cards', 'cards'],
  ['Forms', 'forms'],
  ['Choice', 'choice'],
  ['Overlays', 'overlays'],
  ['Dialog', 'dialog'],
  ['Tabs & tables', 'tables'],
  ['Feedback', 'feedback'],
  ['People & hints', 'people'],
  ['Logs', 'logs'],
  ['Density', 'density'],
  ['Motion', 'motion'],
  ['Icons', 'icons'],
]

export const palette = [
  {
    name: 'Surfaces',
    note: 'Stacked by lightness, never by shadow.',
    swatches: [
      { token: 'bg-sunk', cls: 'bg-bg-sunk', hex: '#09080e' },
      { token: 'bg', cls: 'bg-bg', hex: '#0e0c14' },
      { token: 'surface', cls: 'bg-surface', hex: '#181520' },
      { token: 'surface-2', cls: 'bg-surface-2', hex: '#211d2c' },
      { token: 'surface-3', cls: 'bg-surface-3', hex: '#2b2638' },
    ],
  },
  {
    name: 'Lines',
    note: 'line-control is for control boundaries (3:1).',
    swatches: [
      { token: 'line-soft', cls: 'bg-line-soft', hex: '#231f2f' },
      { token: 'line', cls: 'bg-line', hex: '#2e2a3c' },
      { token: 'line-loud', cls: 'bg-line-loud', hex: '#4a4460' },
      { token: 'line-control', cls: 'bg-line-control', hex: '#6f688a' },
    ],
  },
  {
    name: 'Text',
    note: 'ink-4 is disabled and decoration only.',
    swatches: [
      { token: 'ink', cls: 'bg-ink', hex: '#ebe8f2' },
      { token: 'ink-2', cls: 'bg-ink-2', hex: '#c4bfd3' },
      { token: 'ink-3', cls: 'bg-ink-3', hex: '#a29cb4' },
      { token: 'ink-4', cls: 'bg-ink-4', hex: '#736d88' },
    ],
  },
  {
    name: 'Accent',
    note: 'Dark ink on the accent, never white.',
    swatches: [
      { token: 'accent', cls: 'bg-accent', hex: '#9b7bf5' },
      { token: 'accent-hi', cls: 'bg-accent-hi', hex: '#ae92f8' },
      { token: 'accent-press', cls: 'bg-accent-press', hex: '#8a67ee' },
      { token: 'accent-dim', cls: 'bg-accent-dim', hex: '#5a4a96' },
      { token: 'accent-ghost', cls: 'bg-accent-ghost', hex: '16%' },
      { token: 'accent-ink', cls: 'bg-accent-ink', hex: '#120a2a' },
    ],
  },
  {
    name: 'Status',
    note: 'The only other hues that exist.',
    swatches: [
      { token: 'ok', cls: 'bg-ok', hex: '#3fb27f' },
      { token: 'warn', cls: 'bg-warn', hex: '#e0a43a' },
      { token: 'bad', cls: 'bg-bad', hex: '#ef5b5b' },
      { token: 'ok-ghost', cls: 'bg-ok-ghost', hex: '14%' },
      { token: 'warn-ghost', cls: 'bg-warn-ghost', hex: '14%' },
      { token: 'bad-ghost', cls: 'bg-bad-ghost', hex: '14%' },
    ],
  },
]

// foundations.md "Scale". `cls` is the named utility; label is its use.
export const typeScale = [
  {
    cls: 'text-h1',
    name: 'h1',
    spec: '24/32 · 600 · −0.02em',
    sample: 'Page title',
  },
  {
    cls: 'text-h2',
    name: 'h2',
    spec: '18/26 · 600 · −0.01em',
    sample: 'Section heading',
  },
  {
    cls: 'text-h3',
    name: 'h3',
    spec: '15/22 · 600',
    sample: 'Card title, group heading',
  },
  {
    cls: 'text-body',
    name: 'body',
    spec: '14/20 · 400',
    sample: 'Default text in comfortable mode',
  },
  {
    cls: 'text-sm',
    name: 'sm',
    spec: '13/18 · 400',
    sample: 'Secondary body; the default in compact mode',
  },
  {
    cls: 'text-cap',
    name: 'cap',
    spec: '12/16 · 400',
    sample: 'Captions, hints, metadata',
  },
  {
    cls: 'text-label uppercase',
    name: 'label',
    spec: '11/16 · 500 · 0.06em',
    sample: 'Table headers, eyebrows',
  },
  {
    cls: 'font-mono text-mono',
    name: 'mono',
    spec: '13/20 · 400',
    sample: 'download.lilnas.io',
  },
  {
    cls: 'font-mono text-mono-sm',
    name: 'mono-sm',
    spec: '12/20 · 400',
    sample: '09:14:31 INFO queue drained',
  },
]

export const shapes = [
  { cls: 'rounded-xs', name: 'xs · 4px', use: 'log rows, kbd, skeleton bars' },
  { cls: 'rounded-md', name: 'md · 6px', use: 'controls' },
  { cls: 'rounded-lg', name: 'lg · 8px', use: 'containers' },
  { cls: 'rounded-xl', name: 'xl · 12px', use: 'sheets, app frames' },
  { cls: 'rounded-full', name: 'full', use: 'labels' },
]

// Six apps, in the order DESIGN.md names them. `portal` is the bare host.
export const doorplates = [
  { app: 'portal', note: 'lilnas.io — no subdomain, links nowhere' },
  { app: 'auth', note: 'auth.lilnas.io' },
  { app: 'dev', note: 'dev.lilnas.io' },
  { app: 'download', note: 'download.lilnas.io' },
  { app: 'tdr', note: 'tdr.lilnas.io' },
  { app: 'tdr-code', note: 'tdr-code.lilnas.io' },
]

export const links = [
  { label: 'Library', active: true },
  { label: 'Queue' },
  { label: 'Activity' },
  { label: 'Admin' },
]

export const cols = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status', type: 'badge' },
  { key: 'host', label: 'Source', mono: true },
  { key: 'size', label: 'Size', align: 'right' },
  { key: 'eta', label: 'ETA', align: 'right' },
]

export const rows = [
  {
    title: 'Dune: Part Two',
    status: { tone: 'accent', label: 'Downloading', live: true },
    host: 'nzbgeek.info',
    size: '38.4 GB',
    eta: '12 min',
    selected: true,
  },
  {
    title: 'Severance S02E04',
    status: { tone: 'warn', label: 'Queued' },
    host: 'drunkenslug.com',
    size: '4.1 GB',
    eta: '—',
  },
  {
    title: 'Arcane S02E09',
    status: { tone: 'ok', label: 'Delivered' },
    host: 'nzbgeek.info',
    size: '2.8 GB',
    eta: 'Done',
  },
  {
    title: 'The Bear S03E01',
    status: { tone: 'bad', label: 'Failed' },
    host: 'ETIMEDOUT',
    size: '3.3 GB',
    eta: '—',
  },
  {
    title: 'Chef’s Table S06E02',
    status: { tone: 'mute', label: 'Idle' },
    host: 'nzbplanet.net',
    size: '1.9 GB',
    eta: '—',
  },
]

export const logLines = [
  {
    ts: '09:14:28',
    level: 'INFO',
    src: 'queue',
    msg: 'Picked up "Dune: Part Two" (38.4 GB)',
  },
  {
    ts: '09:14:29',
    level: 'DEBUG',
    src: 'usenet',
    msg: 'connected to news.example.net:563 (tls)',
  },
  {
    ts: '09:14:31',
    level: 'INFO',
    src: 'queue',
    msg: 'Segment 412/9014 · 12.1 MB/s',
  },
  {
    ts: '09:14:44',
    level: 'WARN',
    src: 'radarr',
    msg: 'Slow response from /api/v3/queue (3.2s)',
  },
  {
    ts: '09:15:02',
    level: 'ERROR',
    src: 'sonarr',
    msg: 'ETIMEDOUT while reaching sonarr:8989',
  },
  { ts: '09:15:03', level: 'INFO', src: 'queue', msg: 'Retrying in 30s' },
]

export const comboGroups = [
  {
    name: 'Chest',
    dot: 'bg-accent',
    items: [
      { label: 'Bench press', selected: true },
      { label: 'Incline dumbbell press', highlighted: true },
    ],
  },
  {
    name: 'Back',
    dot: 'bg-ok',
    items: [{ label: 'Barbell row' }, { label: 'Pull-up' }],
  },
  { name: 'Legs', dot: 'bg-warn', items: [{ label: 'Back squat' }] },
]

export const people = ['JA', 'MK', 'TR', 'SL', 'DP', 'WH']
export const storage = [
  { label: 'Media', value: '412 GB of 1 TB', pct: 41 },
  { label: 'Backups', value: '1.7 TB of 2 TB', pct: 86 },
  { label: 'Scratch', value: '237 GB of 240 GB', pct: 98 },
]

export const icons = [
  'activity',
  'alert',
  'arrow',
  'chart',
  'check',
  'chevron',
  'clock',
  'device',
  'discord',
  'download',
  'expand',
  'external',
  'eye',
  'eye-slash',
  'file',
  'film',
  'filter',
  'flag',
  'folder',
  'globe',
  'google',
  'grid',
  'grid-fill',
  'home',
  'inbox',
  'info',
  'key',
  'laptop',
  'layers',
  'list',
  'lock',
  'logout',
  'mail',
  'monitor',
  'more',
  'pause',
  'play',
  'plus',
  'recreate',
  'refresh',
  'search',
  'server',
  'shield',
  'sort',
  'stop',
  'terminal',
  'trash',
  'tv',
  'users',
  'volume',
  'x',
]
