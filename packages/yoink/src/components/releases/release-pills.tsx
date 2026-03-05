import { cns } from '@lilnas/utils/cns'

import { type ParsedRelease } from 'src/media'

// ── Quality tier ──────────────────────────────────────────────────────────────

export type QualityTier = '4k' | '1080p' | 'default'

export function getQualityTier(quality: string | null): QualityTier {
  if (!quality) return 'default'
  const q = quality.toLowerCase()
  if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return '4k'
  if (q.includes('1080')) return '1080p'
  return 'default'
}

export function qualityTierOrder(tier: QualityTier): number {
  if (tier === '4k') return 0
  if (tier === '1080p') return 1
  return 2
}

// ── Quality badge ─────────────────────────────────────────────────────────────

export function QualityBadge({
  quality,
  tier,
}: {
  quality: string
  tier: QualityTier
}) {
  const baseStyles =
    'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.6rem] font-medium leading-none tracking-wide uppercase'

  if (tier === '4k') {
    return (
      <span
        className={cns(
          baseStyles,
          'border-phosphor-500 text-phosphor-400 glow-sm',
        )}
      >
        {quality}
      </span>
    )
  }
  if (tier === '1080p') {
    return (
      <span
        className={cns(baseStyles, 'border-info/60 text-info')}
        style={{ color: 'var(--color-info)', borderColor: 'var(--color-info)' }}
      >
        {quality}
      </span>
    )
  }
  return (
    <span className={cns(baseStyles, 'border-carbon-500 text-carbon-400')}>
      {quality}
    </span>
  )
}

// ── Attribute pills ───────────────────────────────────────────────────────────

export function HdrPill({ label }: { label: string }) {
  return (
    <span
      className={cns(
        'inline-flex items-center rounded px-1.5 py-0.5',
        'font-mono text-[0.6rem] font-semibold uppercase leading-none tracking-wider',
        'border border-warning/50 bg-warning/10 text-warning',
      )}
    >
      {label}
    </span>
  )
}

export function AudioPill({ label }: { label: string }) {
  return (
    <span
      className={cns(
        'inline-flex items-center rounded px-1.5 py-0.5',
        'font-mono text-[0.6rem] font-medium uppercase leading-none tracking-wider',
        'border border-info/40 bg-info/10 text-info',
      )}
    >
      {label}
    </span>
  )
}

export function CodecPill({ label }: { label: string }) {
  return (
    <span
      className={cns(
        'inline-flex items-center rounded px-1.5 py-0.5',
        'font-mono text-[0.6rem] font-medium uppercase leading-none tracking-wider',
        'border border-carbon-500 bg-carbon-700 text-carbon-300',
      )}
    >
      {label}
    </span>
  )
}

export function SourcePill({ label }: { label: string }) {
  return (
    <span
      className={cns(
        'inline-flex items-center rounded px-1.5 py-0.5',
        'font-mono text-[0.6rem] font-medium leading-none tracking-wider',
        'border border-phosphor-700/60 bg-phosphor-900/30 text-phosphor-300',
      )}
    >
      {label}
    </span>
  )
}

export function AttributePills({ parsed }: { parsed: ParsedRelease }) {
  const hasAny =
    parsed.hdr.length > 0 ||
    parsed.audio.length > 0 ||
    parsed.codec !== null ||
    parsed.source.length > 0

  if (!hasAny) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {parsed.source.map(s => (
        <SourcePill key={s} label={s} />
      ))}
      {parsed.hdr.map(h => (
        <HdrPill key={h} label={h} />
      ))}
      {parsed.audio.map(a => (
        <AudioPill key={a} label={a} />
      ))}
      {parsed.codec && <CodecPill label={parsed.codec} />}
    </div>
  )
}
