import { AUDIT_ACTIONS } from '@lilnas/utils/download/schema'
import type { AuditLogEntry } from '@lilnas/utils/download/types'

import {
  AUDIT_ACTION_LEVELS,
  AUDIT_ACTION_PHRASES,
  AUDIT_SERVICE_LABEL,
  auditActorLabel,
  auditLevel,
  describeAuditTarget,
  formatAuditMetadata,
} from 'src/lib/admin-audit'

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    action: 'video.create',
    actor: { email: 'jeremy@lilnas.io', userId: 'u_jeremy' },
    createdAt: '2026-09-16T15:42:08.000Z',
    discordActor: null,
    id: 1,
    metadata: null,
    origin: 'web',
    targetId: 'job-1',
    targetType: 'job',
    ...overrides,
  }
}

describe('AUDIT_ACTION_LEVELS / AUDIT_ACTION_PHRASES', () => {
  // Both maps are `Record<AuditAction, …>`, so an action added upstream is a
  // type error rather than a row that renders blank. This is the runtime half
  // of the same guarantee, for the case where the type is widened by a `dist`
  // that has drifted from `src`.
  it('covers every action in the closed vocabulary', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LEVELS[action]).toBeDefined()
      expect(AUDIT_ACTION_PHRASES[action]).toBeTruthy()
    }
  })

  it('tints destruction bad and housekeeping mute', () => {
    expect(auditLevel('video.delete')).toEqual({ label: 'DELETE', tone: 'bad' })
    expect(auditLevel('ytdlp.check_update')).toEqual({
      label: 'UPDATE',
      tone: 'mute',
    })
  })

  // The manual importer's pair: committing the files is an admin acting on a
  // download that stalled, while discarding one deletes them — so they read at
  // opposite tones despite arriving together.
  it('separates a manual import from the discard it is offered beside', () => {
    expect(auditLevel('media.manual_import')).toEqual({
      label: 'IMPORT',
      tone: 'uv',
    })
    expect(auditLevel('media.discard_download')).toEqual({
      label: 'DISCARD',
      tone: 'bad',
    })
    expect(AUDIT_ACTION_PHRASES['media.manual_import']).toBe(
      'manually imported files',
    )
    expect(AUDIT_ACTION_PHRASES['media.discard_download']).toBe(
      'discarded a stuck download',
    )
  })
})

describe('auditActorLabel', () => {
  // The whole point: a null actor is a service caller, never an anonymous
  // person and never the masked attribution the same `null` means elsewhere.
  it('names the service for an expected null', () => {
    expect(auditActorLabel('service')).toBe(AUDIT_SERVICE_LABEL)
  })

  it('says so out loud when a web request lost its identity', () => {
    expect(auditActorLabel('web')).toBe('unattributed web request')
    expect(auditActorLabel('web')).not.toBe(AUDIT_SERVICE_LABEL)
  })
})

describe('describeAuditTarget', () => {
  it('is null for an action with no target', () => {
    expect(
      describeAuditTarget(
        entry({
          action: 'ytdlp.check_update',
          targetId: null,
          targetType: null,
        }),
      ),
    ).toBeNull()
  })

  it('renders the id alone when the type is missing', () => {
    expect(describeAuditTarget(entry({ targetType: null }))).toBe('job-1')
  })

  it('renders type and id together', () => {
    expect(
      describeAuditTarget(entry({ targetId: 'tmdb:1', targetType: 'media' })),
    ).toBe('media tmdb:1')
  })
})

describe('formatAuditMetadata', () => {
  it('renders arbitrary shapes as indented JSON, with no schema applied', () => {
    expect(
      formatAuditMetadata({
        nested: { deep: [1, 'two', null] },
        whateverThisActionFoundWorthRemembering: true,
      }),
    ).toBe(
      [
        '{',
        '  "nested": {',
        '    "deep": [',
        '      1,',
        '      "two",',
        '      null',
        '    ]',
        '  },',
        '  "whateverThisActionFoundWorthRemembering": true',
        '}',
      ].join('\n'),
    )
  })

  it('is null for nothing to show, so no empty disclosure is drawn', () => {
    expect(formatAuditMetadata(null)).toBeNull()
    expect(formatAuditMetadata({})).toBeNull()
  })
})
