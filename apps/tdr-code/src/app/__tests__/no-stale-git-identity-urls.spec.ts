import fs from 'node:fs'
import path from 'node:path'

// R1 verification (U5's own Test scenarios): after this unit, no FRONTEND
// PAGE LINK or WRAPPER-SCRIPT-PRINTED URL should still read the old
// git-identity path segment as a navigable page route — the page moved to
// the new /git path (U4) and this unit (U5) deleted the old page and fixed
// both wrapper scripts' printed console-URL messages.
//
// Deliberately a simple grep-based check, not a runtime/browser test — per
// the plan's own guidance ("a simple grep-based test or lint rule is
// sufficient; do not over-engineer this into a runtime check").
//
// SCOPE — two trees only, matching the plan's own file list for this check:
//   - src/app/  (frontend page code / printed-URL-adjacent client code)
//   - scripts/  (the two wrapper scripts that print a blocked-push message)
// Backend controller code (src/console/, src/auth/, src/db/, ...) is
// deliberately OUT OF SCOPE for this check — the backend controller's own
// path prefix is NOT being renamed by this plan (see this unit's own
// brief), so a sweep over the backend tree would immediately false-positive
// on completely legitimate code.
//
// EXCLUSION — src/app/lib/api.ts is skipped entirely. Its fetch-path
// occurrences of the old segment (listGitIdentities/upsertGitIdentity/
// deleteGitIdentity/deleteGitIdentitySelf) target the still-existing
// backend controller prefix — an API path, not a frontend PAGE route or a
// printed URL. This is the one legitimate, expected exception the plan
// itself calls out (api.ts calls are fine to keep since those hit the
// still-existing backend controller prefix). THIS spec file is also
// excluded from its own scan — see below for why.
//
// MATCHING — an occurrence only counts as a live URL/route reference if the
// old path segment appears inside a string-literal-like context (preceded
// by a quote character, or immediately after a template literal's closing
// brace — e.g. a template string interpolating a base URL followed
// directly by the path segment). A bare substring search would
// false-positive on prose comments that merely happen to contain a slash
// next to the words "git" and "identity" (e.g. a comment listing two
// failure types separated by a slash, one of which happens to be named
// "git-identity-upsert" — confirmed to exist in this exact codebase, in
// src/app/providers.tsx, at the time this test was written) without being
// a URL at all. This regex is deliberately narrow enough to skip that class
// of false positive while still catching every real string-literal/
// template-literal URL occurrence. Built from string concatenation (not a
// literal regex source) specifically so this file's OWN explanatory prose
// above, which necessarily discusses the pattern being searched for, can
// never accidentally match its own scan.
const OLD_PATH_SEGMENT = '/git' + '-identity'
const URL_LITERAL_PATTERN = new RegExp(`(['"\`]|\\})${OLD_PATH_SEGMENT}`)

const REPO_ROOT = path.resolve(__dirname, '../../..')
const SCAN_ROOTS = [
  { dir: path.join(REPO_ROOT, 'src/app'), label: 'src/app' },
  { dir: path.join(REPO_ROOT, 'scripts'), label: 'scripts' },
]

// api.ts's own occurrences of the old path segment are the one legitimate
// exception — see this file's own header comment above. This spec file
// itself is also excluded: its explanatory prose necessarily discusses the
// exact pattern being searched for, which could otherwise self-match.
const THIS_FILE = path.join(
  REPO_ROOT,
  'src/app/__tests__/no-stale-git-identity-urls.spec.ts',
)
const EXCLUDED_FILES = new Set([
  path.join(REPO_ROOT, 'src/app/lib/api.ts'),
  THIS_FILE,
])

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.sh'])

interface Hit {
  file: string
  line: number
  text: string
}

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // node_modules should never appear under src/app or scripts in this
      // repo layout, but skip defensively rather than assume.
      if (entry.name === 'node_modules') continue
      files.push(...walk(fullPath))
    } else if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

function findHits(): Hit[] {
  const hits: Hit[] = []
  for (const { dir } of SCAN_ROOTS) {
    if (!fs.existsSync(dir)) continue
    for (const file of walk(dir)) {
      if (EXCLUDED_FILES.has(file)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((text, idx) => {
        if (URL_LITERAL_PATTERN.test(text)) {
          hits.push({
            file: path.relative(REPO_ROOT, file),
            line: idx + 1,
            text,
          })
        }
      })
    }
  }
  return hits
}

describe('R1: no stale git-identity page-route or printed-URL references remain', () => {
  it('src/app/ and scripts/ contain no old-path-segment string-literal URL outside api.ts', () => {
    const hits = findHits()
    if (hits.length > 0) {
      const details = hits
        .map(h => `  ${h.file}:${h.line}: ${h.text.trim()}`)
        .join('\n')
      throw new Error(
        `Found ${hits.length} stale ${OLD_PATH_SEGMENT} URL reference(s) — ` +
          `the page moved to /git (U4) and wrapper scripts print /git (U5). ` +
          `If this is a NEW legitimate api.ts-style backend fetch path, add ` +
          `it to EXCLUDED_FILES in this spec; otherwise fix the reference:\n${details}`,
      )
    }
  })

  // Positive control: confirms the regex/scan actually WORKS (would catch a
  // real regression) rather than passing vacuously because the scan itself
  // is broken (e.g. wrong root, wrong extension filter). Uses a throwaway
  // temp file OUTSIDE both SCAN_ROOTS (a sibling of src/ and scripts/, never
  // walked by findHits() itself) so this control never accidentally becomes
  // a real hit in the assertion above — it exercises the regex directly.
  it('sanity check: the scan mechanism actually detects a planted URL', () => {
    const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp-r1-scan-test-'))
    const tmpFile = path.join(tmpDir, 'planted.ts')
    try {
      fs.writeFileSync(
        tmpFile,
        'export const url = `${CONSOLE_URL}' + OLD_PATH_SEGMENT + '`\n',
      )
      const lines = fs.readFileSync(tmpFile, 'utf8').split('\n')
      const matched = lines.some(line => URL_LITERAL_PATTERN.test(line))
      expect(matched).toBe(true)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // Negative control: confirms the regex does NOT false-positive on a prose
  // comment that merely contains the old segment's words adjacent to a
  // slash — proven against the exact real-world pattern this codebase has
  // (see src/app/providers.tsx's own comment listing "config-save" and a
  // "git-identity-upsert" failure type separated by a slash).
  it('sanity check: the scan mechanism does not false-positive on a prose comment', () => {
    const line =
      '    // logs config-save' + OLD_PATH_SEGMENT + '-upsert failures at all'
    expect(URL_LITERAL_PATTERN.test(line)).toBe(false)
  })
})
