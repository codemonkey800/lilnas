# auth — UI mockups

**Open [`index.html`](index.html) in a browser.** No install, no server. Every
`*.html` here is self-contained: its CSS is inlined at build time.

Those `*.html` files are **generated**. Don't edit them — edit the Pug in
`src/` and rebuild, from the repo root:

```bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
pnpm mockups:lint   # prettier check over every designs src/ and the kit
```

The screens are drawn on **Category Standard** with the shared kit in
[`docs/designs/mockup-kit`](../../../designs/mockup-kit). Every page shows its
screen at 1280 and 390 behind the viewport switch, one captioned row per state.

## Pages

| Page                      | Shows                                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`login`](login.html)     | The centred 380px gate card: no target, with a target, `?error=`, redirecting (button loading + toast)                                                                                                                                        |
| [`home`](home.html)       | Account card, status badge, session details, service tiles — admin, member, pending, blocked, no access — and the phone's menu sheet                                                                                                          |
| [`pending`](pending.html) | Waiting, checking (spinning icon) and declined                                                                                                                                                                                                |
| [`blocked`](blocked.html) | Access blocked, and the "Still blocked" toast                                                                                                                                                                                                 |
| [`admin`](admin.html)     | Stats, pending requests, People (table at 1280, card list at 390 from one column definition), Discord links, Blocked, Add person and Edit access dialogs, the destructive confirms that replace `window.confirm`, error boundary, every toast |

## Layout

```
src/
  theme.css       three lines: the two per-project Tailwind lines, then the kit
  mixins/auth.pug auth's own pieces: the gate card, status ring, identity row,
                  target pill, chips, the people list, the admin sections
  pages/*.pug     one per screen; layout only
  data/*.mjs      copy and sample data (shared.mjs is imported by the others)
```

`people`, `requests` and the other sample rows are invented; the services are
the real ones from `apps/auth/src/app/service-meta.ts`.

## Decisions the mockups make

- **Gate screens.** Pending, blocked and the error boundary carry the doorplate
  top-left; login doesn't, because its card is the front door and holds the
  pepe-full mark.
- **Empty state on Home.** "No services granted yet." offers one button, `Check
again`, since the page has no request to make.
- **Verbs.** Reject → **Decline**, Grant access → **Add person**, Save access
  stays; every toast repeats the button's verb (`Approved …`, `Blocked …`,
  `Added …`).
- **People rows.** The kit's `dataList` renders badges and plain values only, so
  the auth rows (name + email, service badges, Discord chip, actions) use
  `authDataList` in `src/mixins/auth.pug`, which follows the kit's table and
  card-list markup from one column definition.
