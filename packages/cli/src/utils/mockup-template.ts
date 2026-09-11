/*
 * The starter a new mockup project is scaffolded from.
 *
 * Deliberately thin. Only `src/pages/*.pug` is required by the builder, and
 * `src/theme.css` is what makes Tailwind classes actually compile — those two
 * plus a layout to hang pages off are the whole starter. Mixins, page data and
 * a client runtime are things a project grows into, not things it starts with,
 * so they're documented in the README rather than stubbed out empty.
 */

export interface TemplateFile {
  /** Path relative to the designs directory. */
  path: string
  contents: string
}

const theme = `/*
 * The Tailwind theme these mockups are drawn with. Put design tokens in the
 * @theme block below and they become utilities (--color-bg -> bg-bg).
 *
 * Source detection is off and pointed at .build/html — the compiled pages, not
 * the .pug sources. Scanning the HTML means Tailwind's extractor sees ordinary
 * class="..." attributes instead of Pug's \`.foo.bar\` shorthand, so utilities
 * containing . or / (text-[15.5px], w-1/2) survive. Don't repoint this at src/.
 */

@import 'tailwindcss' source(none);
@source '../.build/html';

@theme {
  --color-bg: oklch(14% 0.021 300);
  --color-surface: oklch(18.5% 0.027 300);
  --color-line: oklch(29% 0.038 300);
  --color-ink: oklch(97% 0.004 300);
  --color-ink-2: oklch(76% 0.017 300);
  --color-accent: oklch(62% 0.208 295);
}
`

const layout = `//-
  The shell every page extends. Anything that would otherwise be copy-pasted
  into each page — the head, fonts, the page frame — belongs here.

  The builder inlines the compiled Tailwind (and src/runtime.js, if you add
  one) just before </head>, so nothing here needs to link out except fonts.

  Blocks a page fills in:
    title    the full <title>
    head     anything extra in <head> (rare)
    content  the page body

doctype html
html(lang='en')
  head
    meta(charset='utf-8')
    meta(name='viewport' content='width=device-width, initial-scale=1')
    title
      block title
    block head
  body.bg-bg.text-ink.antialiased
    main.mx-auto.max-w-5xl.px-6.py-14
      block content
`

const page = (feature: string) => `extends ../layout/page.pug

block title
  | ${feature} — UI mockups · lilnas

//-
  Pug's \`.foo.bar\` shorthand can't express a utility containing a . or a /
  — \`.px-1.5\` parses as a class \`px-1\` followed by a broken \`.5\`. Write
  those as class='…' instead, like the <code> below. Everything else can use
  the shorthand.

block content
  h1.text-3xl.font-semibold Hello, ${feature}

  p(class='mt-3 text-ink-2')
    | Edit this page at src/pages/index.pug, then run
    code(class='ml-1 rounded bg-surface px-1.5 py-0.5 font-mono text-sm') pnpm mockups
`

const readme = (feature: string) => `# ${feature} — UI mockups

**Open [\`index.html\`](index.html) in a browser.** No install, no server. Every
\`*.html\` here is self-contained: its CSS and JS are inlined at build time.

Those \`*.html\` files are **generated**. Don't edit them — edit the Pug in
\`src/\` and rebuild. Run these from the repo root:

\`\`\`bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
\`\`\`

This directory is not an npm package — no \`package.json\`, no \`node_modules\`.
The builder is \`lilnas mockups build\`, from \`@lilnas/cli\`.

## Layout

Only \`src/pages/\` is required; everything else is picked up if present.

\`\`\`
src/
  theme.css        design tokens as a Tailwind @theme, plus any @utility rules
  runtime.js       optional — inlined into every page as a <script>
  layout/
    page.pug       the shell pages extend
  mixins/*.pug     optional — shared components
  pages/*.pug      one per screen; layout only
  data/*.mjs       optional — copy and sample data, keyed by page name
\`\`\`

\`data/<page>.mjs\` default-exports an object that becomes that page's template
locals. It's \`.mjs\` rather than \`.js\` because there's no \`package.json\` here
to tell Node these are ES modules.
`

/** Every file a fresh mockup project starts with. */
export function mockupTemplate(feature: string): TemplateFile[] {
  return [
    { path: 'README.md', contents: readme(feature) },
    { path: 'src/theme.css', contents: theme },
    { path: 'src/layout/page.pug', contents: layout },
    { path: 'src/pages/index.pug', contents: page(feature) },
  ]
}
