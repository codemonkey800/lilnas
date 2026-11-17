// Copy and sample data for session.pug. A turn is one prompt and the agent's
// answer to it; a block is one piece of that (prompt, agent_text, tool_call,
// diff). Fact strings (tool kinds, statuses, paths) stay machine-shaped.

const readTool = {
  kind: 'tool_call',
  title: 'Read apps/tdr-code/src/app/page.tsx',
  toolKind: 'read',
  status: 'completed',
}

const diff = {
  kind: 'diff',
  path: 'apps/tdr-code/src/app/components/status-dot.tsx',
  newText: `export function StatusDot({ variant }: { variant: Variant }) {
  return (
    <span
      aria-hidden
      className={cns('size-2 rounded-full', DOT[variant])}
    />
  )
}`,
}

const plan = {
  kind: 'tool_call',
  title: 'ExitPlanMode',
  toolKind: 'switch_mode',
  status: 'completed',
  planOutcome: 'accepted',
  planText:
    '1. Swap the gray dots for status tokens.\n2. Pulse only the online one.\n3. Update the dashboard spec.',
}

export const turns = {
  completed: {
    index: 1,
    status: 'completed',
    ended: '12m ago',
    content: [
      {
        kind: 'prompt',
        text: 'The status dot on the dashboard is the wrong green and it never pulses. Fix it.',
      },
      {
        kind: 'agent_text',
        text: "I'll start with where the dot is drawn, then check which variants the dashboard passes.",
      },
      readTool,
      plan,
      diff,
      {
        kind: 'agent_text',
        text: 'Done. The online dot is ok-green and pulses; every other variant is static.',
      },
    ],
  },
  withImage: {
    index: 2,
    status: 'completed',
    ended: '9m ago',
    content: [
      {
        kind: 'prompt',
        text: 'Does it match this?',
        images: 1,
      },
      {
        kind: 'agent_text',
        text: 'Yes — same dot, same colour. The label under it is 13px in the screenshot and 14px here.',
      },
    ],
  },
  running: {
    index: 3,
    status: 'running',
    content: [
      {
        kind: 'prompt',
        text: 'Make the label 13px and run the frontend tests.',
      },
      {
        kind: 'tool_call',
        title: 'pnpm --filter @lilnas/tdr-code test',
        toolKind: 'execute',
        status: 'in_progress',
      },
    ],
  },
  errored: {
    index: 4,
    status: 'errored',
    ended: '2h ago',
    content: [
      { kind: 'prompt', text: 'Push it.' },
      {
        kind: 'tool_call',
        title: 'git push origin feat/status-dot',
        toolKind: 'execute',
        status: 'failed',
      },
    ],
  },
  cancelled: {
    index: 5,
    status: 'cancelled',
    ended: '2h ago',
    content: [{ kind: 'prompt', text: 'Actually, hold on.' }],
  },
  interrupted: {
    index: 6,
    status: 'interrupted',
    ended: '2h ago',
    content: [
      { kind: 'prompt', text: 'Rebase onto main and resolve the conflicts.' },
      {
        kind: 'agent_text',
        text: 'Rebasing. Two files conflict: nav-shell.tsx and page.tsx.',
      },
    ],
  },
  empty: { index: 7, status: 'completed', ended: '2h ago', content: [] },
  rejected: {
    index: 8,
    status: 'completed',
    ended: '1d ago',
    content: [
      {
        ...plan,
        planOutcome: 'rejected',
        planText: '1. Rewrite the whole shell.\n2. Drop the sessions page.',
      },
      {
        ...plan,
        planOutcome: 'superseded',
        planText: '1. Keep the shell; swap the tokens only.',
      },
    ],
  },
}

const meta = {
  channel: '#ops-agent',
  channelId: '1184726493302157312',
  user: 'Jeremy',
  created: '14m ago',
}

export const sessions = {
  active: { id: 4826, ...meta, active: true },
  ended: {
    id: 4824,
    ...meta,
    channel: '#design-review',
    user: 'Alex',
    created: '3h ago',
    ended: '2h ago',
    reason: 'teardown',
  },
}

export const reconcile = {
  idle: { state: 'idle' },
  loading: { state: 'loading' },
  clean: { state: 'clean', matched: 41, missing: 0, extra: 0, mismatched: 0 },
  drift: {
    state: 'drift',
    matched: 38,
    missing: 2,
    extra: 1,
    mismatched: 1,
    skipped: 3,
    cappedAt: '5242880',
  },
  cannot: {
    state: 'cannot',
    reason: 'no-jsonl-file: ~/.claude/projects/-ops/9f2c.jsonl',
  },
  error: {
    state: 'error',
    error: {
      detail: "The server didn't answer. Try again in a minute.",
      code: 'POST /api/sessions/4826/reconcile 502',
    },
  },
}

export const copy = {
  dropped: '3 malformed blocks dropped from view.',
  loading: 'Fetching session #4826…',
  error: {
    lead: "Couldn't load session #4826.",
    detail: "The server didn't answer. Try again in a minute.",
    code: 'GET /api/sessions/4826 502',
  },
  emptyTurns: {
    title: 'No turns recorded',
    body: "The session started but hasn't been given a prompt.",
  },
  notFound: {
    title: 'Session not found',
    body: "#9999 isn't a session the bot has run.",
    action: 'Back to sessions',
  },
}

export const states = [
  {
    label: 'Active',
    caption: 'a running turn, polling every 5s',
    session: sessions.active,
    turns: [turns.completed, turns.withImage, turns.running],
    reconcile: reconcile.idle,
  },
  {
    label: 'Ended',
    caption: 'every turn status and a dropped-blocks note',
    session: sessions.ended,
    dropped: true,
    turns: [
      turns.completed,
      turns.errored,
      turns.cancelled,
      turns.interrupted,
      turns.empty,
      turns.rejected,
    ].map((t, i) => ({ ...t, index: i + 1 })),
    reconcile: reconcile.idle,
  },
  {
    label: 'No turns',
    caption: 'a session nobody has prompted',
    session: sessions.active,
    turns: [],
    reconcile: reconcile.idle,
  },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the session didn't load", body: 'error' },
  { label: 'Not found', caption: 'not-found.tsx', body: 'not-found' },
]

export const reconcileStates = [
  {
    label: 'Reconcile · idle',
    caption: 'before Run reconcile',
    r: reconcile.idle,
  },
  { label: 'Reconcile · running', caption: 'comparing', r: reconcile.loading },
  {
    label: 'Reconcile · clean',
    caption: 'every count matches',
    r: reconcile.clean,
  },
  {
    label: 'Reconcile · drift',
    caption: 'missing, extra, mismatched, skipped, capped',
    r: reconcile.drift,
  },
  {
    label: 'Reconcile · cannot reconcile',
    caption: 'no JSONL to compare against',
    r: reconcile.cannot,
  },
  {
    label: 'Reconcile · error',
    caption: 'the request failed',
    r: reconcile.error,
  },
]
