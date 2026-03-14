export interface ParsedRelease {
  hdr: string[]
  audio: string[]
  codec: string | null
  source: string[]
  group: string | null
}

// Normalize dots/underscores to spaces for token matching
function normalize(title: string): string {
  return title.replace(/[._]/g, ' ')
}

export function parseReleaseName(title: string | null): ParsedRelease {
  if (!title) {
    return { hdr: [], audio: [], codec: null, source: [], group: null }
  }

  const norm = normalize(title)
  const upper = norm.toUpperCase()

  // ── HDR ──────────────────────────────────────────────────────────────────
  const hdr: string[] = []

  // Dolby Vision -- check before plain "DV" to avoid false positives
  if (/\bDOLBY\s*VISION\b|\bDOVI\b|\bDV\b/i.test(norm)) hdr.push('DV')
  if (/\bHDR10\+/i.test(norm)) hdr.push('HDR10+')
  else if (/\bHDR10\b/i.test(norm)) hdr.push('HDR10')
  else if (/\bHDR\b/i.test(upper)) hdr.push('HDR')
  if (/\bHLG\b/i.test(norm)) hdr.push('HLG')

  // ── Audio ─────────────────────────────────────────────────────────────────
  const audio: string[] = []

  if (/\bATMOS\b/i.test(norm)) audio.push('Atmos')
  if (/\bTRUEHD\b/i.test(norm)) audio.push('TrueHD')
  if (/\bDTS[\s-]?HD\b/i.test(norm)) audio.push('DTS-HD')
  if (/\bDTS[\s-]?X\b/i.test(norm)) audio.push('DTS:X')
  else if (/\bDTS\b/i.test(norm)) audio.push('DTS')
  // DDP with channel variants (e.g. DDP5.1, DDP 7.1)
  const ddpMatch = norm.match(/\bDDP\s*([\d.]+)/i)
  if (ddpMatch) {
    audio.push(`DDP ${ddpMatch[1]}`)
  } else if (/\bDDP\b/i.test(norm)) {
    audio.push('DDP')
  }
  // DD with channel (non-DDP)
  if (!audio.some(a => a.startsWith('DDP'))) {
    const ddMatch = norm.match(/\bDD\s*([\d.]+)/i)
    if (ddMatch) audio.push(`DD ${ddMatch[1]}`)
  }
  if (/\bFLAC\b/i.test(norm)) audio.push('FLAC')
  if (/\bAAC\b/i.test(norm)) audio.push('AAC')
  if (/\bMP3\b/i.test(norm)) audio.push('MP3')
  if (/\bPCM\b/i.test(norm)) audio.push('PCM')
  if (/\bOPUS\b/i.test(norm)) audio.push('Opus')
  // MA (Master Audio) -- only when following a known lossless codec e.g. "TrueHD MA" / "DTS-HD MA"
  if (/\b(?:DTS[\s-]?HD|TrueHD)\s*MA\b/i.test(norm)) audio.push('MA')

  // ── Codec ─────────────────────────────────────────────────────────────────
  let codec: string | null = null

  if (/\bAV1\b/i.test(norm)) {
    codec = 'AV1'
  } else if (/\bHEVC\b|\bH[\s.]?265\b|\bX265\b/i.test(norm)) {
    codec = 'H.265'
  } else if (/\bAVC\b|\bH[\s.]?264\b|\bX264\b/i.test(norm)) {
    codec = 'H.264'
  } else if (/\bVP9\b/i.test(norm)) {
    codec = 'VP9'
  }

  // ── Source / Special Tags ─────────────────────────────────────────────────
  const source: string[] = []

  if (/\bHYBRID\b/i.test(norm)) source.push('Hybrid')
  if (/\bIMAX\b/i.test(norm)) source.push('IMAX')
  if (/\bREMUX\b/i.test(norm)) source.push('Remux')
  if (/\bMULTI\b/i.test(norm)) source.push('Multi')
  if (/\bEXTENDED\b/i.test(norm)) source.push('Extended')
  if (/\bDIRECTOR[\s']?S\s*CUT\b/i.test(norm)) source.push("Director's Cut")
  if (/\bREPACK\b/i.test(norm)) source.push('Repack')
  if (/\bPROPER\b/i.test(norm)) source.push('Proper')

  // ── Release Group ─────────────────────────────────────────────────────────
  // The release group is the token after the last `-` in the original title
  // but only if it looks like a group name (no spaces, reasonable length)
  let group: string | null = null
  const lastDash = title.lastIndexOf('-')
  if (lastDash !== -1) {
    const candidate = title.slice(lastDash + 1).trim()
    // A valid group name: 2-20 chars, alphanumeric (possibly mixed case), no spaces
    if (/^[A-Za-z0-9]{2,20}$/.test(candidate)) {
      group = candidate
    }
  }

  return { hdr, audio, codec, source, group }
}
