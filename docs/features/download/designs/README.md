# download — UI mockups

**Open [`index.html`](index.html) in a browser.** No install, no server. Every
`*.html` here is self-contained: its CSS and JS are inlined at build time.

Those `*.html` files are **generated**. Don't edit them — edit the Pug in
`src/` and rebuild.

Run these **from the repo root**:

Run these **from the repo root**:

```bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
pnpm build          # builds these too, cached — skipped when src/ is unchanged
pnpm lint           # includes a prettier check over every designs src/
```

This directory is **not** an npm package — no `package.json`, no `turbo.json`,
no `node_modules`. Only the design lives here. The builder is `lilnas mockups
build`, from [`@lilnas/cli`](../../../../packages/cli), and it builds any
`docs/features/*/designs` directory laid out as below.

With that CLI on your `PATH` you can also drive it directly, which is the only
way to build a single project when there's more than one:

```bash
lilnas mockups build           # this directory only, when run from inside it;
                               # every designs directory from anywhere else
lilnas mockups build download  # by name, from anywhere
lilnas mockups list            # what it can find
```

`pnpm` puts the CLI on `PATH` for its own scripts, so the `pnpm` forms always
work. A bare `lilnas` in an ordinary shell needs `<repo>/node_modules/.bin` on
your `PATH`.

Starting a set of mockups for another feature is `lilnas mockups new <feature>`,
which scaffolds `docs/features/<feature>/designs` and builds it. Nothing needs
registering afterwards — the turbo task, the prettier check and the `.gitignore`
all match `docs/features/*/designs`.

---

## Why there's a build step at all

There used to be eleven hand-written HTML files, each carrying its own ~800
line `<style>` block. The blocks were copies of each other, so they drifted:
by the time this build landed, 21 CSS rules and 4 icons had quietly diverged
between files, and the same "just fix the card hover" edit had to be made in
nine places or not at all.

Now there is one theme, one layout, one set of components, and eleven pages
that only describe what's on them.

## Layout

This is the shape `lilnas mockups build` expects. Only `pages/` is required;
the rest are picked up if present.

```
src/
  theme.css        Ultraviolet as a Tailwind theme, plus the handful of
                   utilities Tailwind can't compose (stagger, skeleton, the
                   live pulse, the press transition)
  runtime.js       the entire client-side runtime — a poster-art fallback
  layout/
    page.pug       the shell: head, fonts, sprite, page column
    sprite.html    every icon, as one <symbol> set
  mixins/
    ui.pug         Ultraviolet primitives — button, chip, poster, card, table…
    mock.pug       the mockup furniture — app frame, nav bar, viewport switch
  pages/*.pug      one per screen; layout only
  data/*.mjs       copy and sample data for the pages that have a lot of it
                   (.mjs, not .js — there's no package.json here to tell Node
                   these are ES modules)
```

### How the build works

1. Pug renders `src/pages/*.pug` into `.build/html/`.
2. Tailwind scans **that HTML** — not the `.pug` — and emits one stylesheet.
   Scanning the compiled output means the extractor sees ordinary
   `class="..."` attributes, so utilities containing `.` or `/`
   (`text-[15.5px]`, `w-1/2`) survive Pug's `.foo.bar` shorthand.
3. The stylesheet and `runtime.js` are inlined into each page, the result is
   run through Prettier, and written to `./<page>.html`.

### Conventions

- **Tailwind utilities in the markup.** The old semantic classes are gone:
  `.row` is `flex items-center gap-2.5`, `.h2` is `text-h2`, `.dim` is
  `text-ink-3`. Reuse comes from Pug mixins, not from class names.
- **`@utility` only when Tailwind genuinely can't compose it** — per-child
  animation delays, `::after` pseudo-elements, a transition that needs two
  different easings. Each one in `theme.css` says why.
- **A mixin owns its variants end to end.** A variant sets its own border
  colour and padding rather than overriding a base value, because two
  utilities for the same property on one element resolve by Tailwind's output
  order, not by the order you wrote them.
- **Every mixin ends in `&attributes(attributes)`**, so call sites can pass
  layout classes without the mixin needing a parameter for them.
- **No behavioural JS.** The desktop/mobile switch and every "open" state are
  CSS — hidden radios read with `:has()`. These files get opened through
  wrappers (iframe `srcdoc` among them) where a page's own `<script>` never
  runs, and a mockup has to read correctly regardless.

### Where the design system lives

`theme.css` reproduces the `@theme` block from
[`../../../designs/foundations.md`](../../designs/foundations.md), which is
canonical. Anything in `theme.css` that isn't in `foundations.md` is marked as
a mockup-local addition — mostly the named type scale (`text-h2`, `text-label`)
from that doc's type table, which the block itself doesn't yet include.

## Known inconsistencies, preserved

The port kept these rather than silently reconciling them; they're decisions
someone should make, not transcription slips.

- `nav-search.html` renders its search field at 44px, including the one in the
  app bar, where every other page uses the 32px default.
- Four icons had drifted between copies (`i-search`, `i-x`, `i-check`,
  `i-grid`). Each is now the version most pages used — except the filled grid,
  which is a genuinely different icon (the grid/list toggle in search) and is
  kept alongside as `i-grid-fill`.
- The `downloading` chip on `video-detail.html` stretches to the full column
  width, because it's a flex child in a stretch container.

## Artwork

Poster art and video thumbnails are **not committed** — see
[`assets/README.md`](assets/README.md). Without them, every poster falls back
to a gradient stand-in and the mockups still read fine.
