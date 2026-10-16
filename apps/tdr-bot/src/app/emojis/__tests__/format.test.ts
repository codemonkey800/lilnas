import type { EmojiView, ReconcileStatus } from 'src/api/api.types'
import {
  canSaveDescription,
  filterCounts,
  hasActions,
  isPending,
  matchesFilter,
  matchesSearch,
  needsRedescribeConfirm,
  reconcileStatusLine,
  relativeTime,
  sourceLabel,
  sourceTone,
  visibleEmojis,
} from 'src/app/emojis/format'

const now = new Date('2026-10-14T12:00:00.000Z')

function view(overrides: Partial<EmojiView> = {}): EmojiView {
  return {
    id: '1',
    guildId: 'g1',
    name: 'HYPERS',
    animated: false,
    key: '<:HYPERS:1>',
    imageUrl: 'https://cdn.discordapp.com/emojis/1.png',
    description: 'Pepe vibrating with excitement.',
    source: 'ai',
    model: 'gpt-5-mini',
    describedAt: '2026-10-14T09:02:00.000Z',
    deletedAt: null,
    updatedAt: '2026-10-14T09:02:00.000Z',
    ...overrides,
  }
}

const manual = view({ id: 'm', name: 'monkaS', source: 'manual', model: null })
const ai = view({ id: 'a', name: 'Sadge', description: 'A sad frog.' })
const pending = view({
  id: 'p',
  name: 'Loading',
  description: null,
  source: null,
  model: null,
  describedAt: null,
})
const deleted = view({
  id: 'd',
  name: 'OldHype',
  deletedAt: '2026-10-02T00:00:00.000Z',
})
const all = [manual, ai, pending, deleted]

describe('matchesFilter', () => {
  it('matches every row for all', () => {
    expect(all.every(e => matchesFilter(e, 'all'))).toBe(true)
  })

  it('matches rows without a description for pending', () => {
    expect(all.filter(e => matchesFilter(e, 'pending'))).toEqual([pending])
  })

  it('does not count deleted rows without a description as pending', () => {
    const gone = view({
      description: null,
      source: null,
      deletedAt: now.toISOString(),
    })
    expect(isPending(gone)).toBe(false)
    expect(matchesFilter(gone, 'deleted')).toBe(true)
  })

  it('matches by source, deleted rows included', () => {
    expect(all.filter(e => matchesFilter(e, 'ai'))).toEqual([ai, deleted])
    expect(all.filter(e => matchesFilter(e, 'manual'))).toEqual([manual])
  })

  it('matches soft-deleted rows for deleted', () => {
    expect(all.filter(e => matchesFilter(e, 'deleted'))).toEqual([deleted])
  })
})

describe('matchesSearch', () => {
  it('matches everything for blank text', () => {
    expect(all.every(e => matchesSearch(e, '  '))).toBe(true)
  })

  it('matches the name case-insensitively', () => {
    expect(matchesSearch(manual, 'MONKA')).toBe(true)
    expect(matchesSearch(manual, 'sadge')).toBe(false)
  })

  it('matches the description', () => {
    expect(matchesSearch(ai, ' sad frog ')).toBe(true)
  })

  it('handles a null description', () => {
    expect(matchesSearch(pending, 'frog')).toBe(false)
    expect(matchesSearch(pending, 'load')).toBe(true)
  })
})

describe('visibleEmojis', () => {
  it('applies the filter and the search together', () => {
    expect(visibleEmojis(all, 'ai', 'old')).toEqual([deleted])
    expect(visibleEmojis(all, 'manual', 'old')).toEqual([])
  })
})

describe('filterCounts', () => {
  it('counts each filter', () => {
    expect(filterCounts(all)).toEqual({
      all: 4,
      pending: 1,
      ai: 2,
      manual: 1,
      deleted: 1,
    })
  })

  it('returns zeros for an empty list', () => {
    expect(filterCounts([])).toEqual({
      all: 0,
      pending: 0,
      ai: 0,
      manual: 0,
      deleted: 0,
    })
  })
})

describe('relativeTime', () => {
  it('says just now within a minute, and for future times', () => {
    expect(relativeTime('2026-10-14T11:59:30.000Z', now)).toBe('just now')
    expect(relativeTime('2026-10-14T12:05:00.000Z', now)).toBe('just now')
  })

  it('formats minutes, hours and days', () => {
    expect(relativeTime('2026-10-14T11:57:00.000Z', now)).toBe('3 min ago')
    expect(relativeTime('2026-10-14T10:00:00.000Z', now)).toBe('2 h ago')
    expect(relativeTime('2026-10-10T11:00:00.000Z', now)).toBe('4 d ago')
  })
})

describe('reconcileStatusLine', () => {
  const last: NonNullable<ReconcileStatus['last']> = {
    trigger: 'boot',
    synced: 140,
    softDeleted: 0,
    seeded: 0,
    described: 2,
    failed: 0,
    durationMs: 1200,
    finishedAt: '2026-10-14T11:57:00.000Z',
  }

  it('says no reconcile has run', () => {
    expect(reconcileStatusLine({ running: false, last: null }, now)).toBe(
      'No reconcile has run yet',
    )
  })

  it('summarises the last run', () => {
    expect(reconcileStatusLine({ running: false, last }, now)).toBe(
      'Last reconcile 3 min ago (boot) · 140 synced · 2 described · 0 failed',
    )
  })

  it('labels the trigger', () => {
    const line = (trigger: typeof last.trigger) =>
      reconcileStatusLine({ running: false, last: { ...last, trigger } }, now)
    expect(line('cron')).toContain('(nightly)')
    expect(line('admin')).toContain('(manual)')
    expect(line('event')).toContain('(gateway event)')
  })

  it('shows a run this page started', () => {
    expect(
      reconcileStatusLine({ running: true, last }, now, new Date(now)),
    ).toBe('Started just now (manual)')
  })

  it('does not claim a run that started after ours finished', () => {
    const startedAt = new Date('2026-10-14T11:50:00.000Z')
    expect(reconcileStatusLine({ running: true, last }, now, startedAt)).toBe(
      'Reconcile running…',
    )
  })

  it('shows a run started elsewhere', () => {
    expect(reconcileStatusLine({ running: true, last: null }, now)).toBe(
      'Reconcile running…',
    )
  })
})

describe('sourceLabel / sourceTone', () => {
  it('maps each source', () => {
    expect([manual, ai, pending].map(sourceLabel)).toEqual([
      'manual',
      'ai',
      'pending',
    ])
    expect([manual, ai, pending].map(sourceTone)).toEqual([
      'ok',
      'muted',
      'warn',
    ])
  })
})

describe('canSaveDescription', () => {
  it('rejects blank drafts', () => {
    expect(canSaveDescription('   ', 'old')).toBe(false)
  })

  it('rejects unchanged drafts, ignoring surrounding whitespace', () => {
    expect(canSaveDescription(' old ', 'old')).toBe(false)
  })

  it('rejects drafts over 300 characters', () => {
    expect(canSaveDescription('x'.repeat(301), null)).toBe(false)
    expect(canSaveDescription('x'.repeat(300), null)).toBe(true)
  })

  it('accepts a changed draft, including for a pending row', () => {
    expect(canSaveDescription('new', 'old')).toBe(true)
    expect(canSaveDescription('new', null)).toBe(true)
  })
})

describe('row actions', () => {
  it('confirms re-describing only manual rows', () => {
    expect(needsRedescribeConfirm(manual)).toBe(true)
    expect(needsRedescribeConfirm(ai)).toBe(false)
    expect(needsRedescribeConfirm(pending)).toBe(false)
  })

  it('gives deleted rows no actions', () => {
    expect(hasActions(deleted)).toBe(false)
    expect(hasActions(manual)).toBe(true)
  })
})
