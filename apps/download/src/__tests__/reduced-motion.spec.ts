import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `prefers-reduced-motion` coverage, checked against the stylesheet itself.
 *
 * ⚠️ **This is deliberately a static analysis, not a rendering test, and the
 * distinction is the whole point of the file.**
 *
 * Every animation in this app is pure CSS — there is no `matchMedia` call
 * anywhere in `src/`, no Web Animations API use, no smooth scrolling and no
 * interval-driven motion (asserted below). That is the right design: a
 * `@media` block is already true during SSR and on the first paint, where a
 * `matchMedia` listener is one effect late, so moving any of this into JS
 * would make it worse rather than testable.
 *
 * The consequence is that jsdom cannot verify a single one of these rules —
 * it parses no stylesheet and computes no styles from one, so
 * `getComputedStyle` would report the same thing whether the reduced-motion
 * block existed or not. Asserting on it there would produce a test that
 * passes with the entire block deleted.
 *
 * What *is* honestly checkable without a browser is the thing that actually
 * goes wrong: someone adds an animated utility and forgets to cover it. That
 * is a text-level property of this one file, and it is exactly how the live
 * pulse went uncovered. So the stylesheet is parsed and the two lists — what
 * is animated, and what is exempted — are required to agree.
 *
 * Whether the reduced-motion rules *look* right on screen is a browser
 * question and is not claimed here.
 */

const STYLESHEET = join(__dirname, '..', 'tailwind.css')

const css = readFileSync(STYLESHEET, 'utf8')

/**
 * Pulls a brace-balanced block out of `source`, starting at the first match of
 * `opening`. A regex cannot do this — nested `&::after { … }` rules inside an
 * `@utility` would stop it at the first `}`.
 */
function blockAfter(source: string, opening: RegExp): string {
  const start = source.search(opening)

  if (start < 0) {
    return ''
  }

  const from = source.indexOf('{', start)

  if (from < 0) {
    return ''
  }

  let depth = 0

  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1

      if (depth === 0) {
        return source.slice(from + 1, index)
      }
    }
  }

  return ''
}

/** Every `@utility <name>` in the sheet whose body declares an `animation`. */
function animatedUtilities(): string[] {
  const names: string[] = []
  const pattern = /@utility\s+([\w-]+)\s*\{/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(css))) {
    const name = match[1]

    if (name === undefined) {
      continue
    }

    const body = blockAfter(css.slice(match.index), /@utility/)

    if (/\banimation\s*:/.test(body)) {
      names.push(name)
    }
  }

  return names.sort()
}

const reducedMotionBlock = blockAfter(
  css,
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/,
)

/**
 * Animated classes that come from Tailwind itself rather than from this sheet,
 * so the parser above cannot see them, and which are therefore covered only by
 * the blanket clamp.
 *
 * `animate-spin` is the loading spinner in `ui/feedback.tsx`. Leaving it to the
 * clamp is the deliberate answer rather than an oversight: the clamp freezes
 * it at its start angle, and a still spinner still says "busy" by being
 * present. Unlike the live pulse, its frozen state is one the design already
 * draws, so it needs no bespoke resting rule.
 */
const CLAMP_ONLY: readonly string[] = ['animate-spin']

describe('the reduced-motion block exists and is reachable', () => {
  it('is present at all', () => {
    expect(reducedMotionBlock).not.toBe('')
  })

  it('clamps every animation and every transition on every element', () => {
    // The floor under everything else: even an animation nobody remembered to
    // name below cannot keep running.
    expect(reducedMotionBlock).toMatch(/\*::before/)
    expect(reducedMotionBlock).toMatch(/\*::after/)
    expect(reducedMotionBlock).toMatch(
      /animation-duration:\s*0\.01ms\s*!important/,
    )
    expect(reducedMotionBlock).toMatch(
      /animation-iteration-count:\s*1\s*!important/,
    )
    expect(reducedMotionBlock).toMatch(
      /transition-duration:\s*0\.01ms\s*!important/,
    )
  })
})

describe('every animated utility is named in the reduced-motion block', () => {
  it('finds the animated utilities it expects to find', () => {
    // Pins the parser itself. If a refactor renames these or changes how they
    // declare their animation, this fails loudly rather than silently finding
    // nothing and declaring perfect coverage below.
    expect(animatedUtilities()).toEqual([
      'bar-settling',
      'dot-live',
      'reveal',
      'skeleton',
      'stagger',
    ])
  })

  it.each(animatedUtilities())(
    '`%s` is switched off by name, not merely clamped',
    utility => {
      // ⚠️ Being caught by the blanket clamp is NOT sufficient, and the live
      // pulse is why. The clamp runs an animation once for 0.01ms; an
      // animation with no `forwards` fill then *reverts to its unanimated
      // state*, which for a pulse ring is fully opaque rather than invisible.
      // Stopping the motion and landing somewhere the design never draws is
      // still a bug, so each animated utility owes an explicit resting state.
      expect(reducedMotionBlock).toContain(`.${utility}`)
    },
  )

  it.each(animatedUtilities())('`%s` has its animation cancelled', utility => {
    const rule = reducedMotionBlock.slice(
      reducedMotionBlock.indexOf(`.${utility}`),
    )

    expect(rule).toMatch(/animation:\s*none\s*!important/)
  })
})

/** Every `.tsx` under `src/`, tests excluded. */
function componentSources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') {
        componentSources(path, found)
      }
    } else if (path.endsWith('.tsx')) {
      found.push(path)
    }
  }

  return found
}

const SOURCE_ROOT = join(__dirname, '..')

/**
 * The animated class names the markup actually applies.
 *
 * Matched as whole words inside string literals, so the prose in a docblock
 * that merely *mentions* `stagger` does not count as a use — several of these
 * components explain the motion at length in comments.
 */
function animatedClassesInUse(): string[] {
  const candidates = [...animatedUtilities(), ...CLAMP_ONLY]
  const used = new Set<string>()

  for (const file of componentSources(SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8')
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    for (const candidate of candidates) {
      const inClassString = new RegExp(
        `['"\`][^'"\`]*\\b${candidate}\\b[^'"\`]*['"\`]`,
      )

      if (inClassString.test(withoutComments)) {
        used.add(candidate)
      }
    }
  }

  return Array.from(used).sort()
}

describe('the animated utilities and the components agree', () => {
  it('every animated utility is actually reached by some component', () => {
    // A utility nothing uses is dead weight whose reduced-motion rule nobody
    // will maintain; a class the markup uses that the sheet never defines is a
    // silent no-op. Both directions are checked, here and below.
    const used = animatedClassesInUse()

    for (const utility of animatedUtilities()) {
      expect(used).toContain(utility)
    }
  })

  it('every animated class the components use is accounted for', () => {
    const covered = [...animatedUtilities(), ...CLAMP_ONLY]

    for (const used of animatedClassesInUse()) {
      expect(covered).toContain(used)
    }
  })

  it('no component reaches for motion that JavaScript would have to stop', () => {
    // The other half of the split. Everything above is only sound because all
    // of this app's motion is CSS: a `@media` block covers it during SSR and
    // on the first paint, where a `matchMedia` listener would be one effect
    // late. The moment something animates from JS, the stylesheet stops being
    // the whole answer and this file stops being a sufficient check.
    const offenders: string[] = []

    for (const file of componentSources(SOURCE_ROOT)) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')

      if (
        /behavior:\s*['"]smooth['"]/.test(source) ||
        /\.animate\(/.test(source) ||
        /\bautoPlay\b/.test(source)
      ) {
        offenders.push(file.slice(SOURCE_ROOT.length + 1))
      }
    }

    expect(offenders).toEqual([])
  })
})
