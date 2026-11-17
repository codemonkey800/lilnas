# tdr-code — UI mockups

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
[`docs/designs/mockup-kit`](../../../designs/mockup-kit), at **compact density**
(`data-density='compact'`: 30px controls, 13px body). Every page shows its screen
at 1280 and 390 behind the viewport switch, one captioned row per state. The phone
layout is new: tdr-code has never had one.

## Pages

| Page                            | Shows                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`login`](login.html)           | The 380px card and its one accent button; each `?error=` note; redirecting                                                                                                     |
| [`dashboard`](dashboard.html)   | Bot status, Restart bot (inline confirm), active sessions with Tear down (inline confirm, row error); offline, starting, never run, empty, loading, error; the phone nav sheet |
| [`sessions`](sessions.html)     | Channel filter and Clear, the session list, Load more; filtered, filtered-to-nothing, empty, loading, error                                                                    |
| [`session`](session.html)       | Meta, every turn status and block type, the dropped-blocks note, the reconcile panel in all six states; no turns, loading, error, not found                                    |
| [`events`](events.html)         | Type / level / channel filters and the feed; the open type menu, filtered, filtered-to-nothing, empty, loading, error                                                          |
| [`logs`](logs.html)             | Three tabs, filters and search as one toolbar, the status banner, the viewer, every edge and the detail sheet                                                                  |
| [`config`](config.html)         | The global config form: save states, offline note, field errors, char-limit warning, loading, error                                                                            |
| [`git`](git.html)               | GitHub, SSH key and roster panels, each with its own states and inline confirms                                                                                                |
| [`boundaries`](boundaries.html) | The segment error (nav stays) and the global error (inline-styled, with the values it must copy in)                                                                            |

## Layout

```
src/
  theme.css         three lines: the two per-project Tailwind lines, then the kit
  mixins/tdr-code.pug  tdr-code's own pieces: the shell (app bar, nav sheet),
                    confirmPair, botStatus, tdrList, turnCard / contentBlock,
                    logRow, reconcilePanel, jsonView, cfgField
  pages/*.pug       one per screen; layout only
  data/*.mjs        copy and sample data, one file per page
```

Sample rows are invented; the tabs, columns, event types, config fields and copy
keys are the real ones from `apps/tdr-code`.

## Decisions the mockups make

- **Phone nav.** The six links collapse into a bottom `sheet` opened from the app
  bar's menu button; Log out and the user sit at its foot. The active link is the
  accent ghost.
- **Inline two-step confirms everywhere.** Restart bot, Tear down, SSH Clear and
  the roster's two Clear buttons swap in place for a prompt and **Confirm /
  Cancel** (the app's existing labels and `data-track-id`s). The prompt names the
  object (`Unlink Sam's GitHub?`); the destructive step is outlined red, Cancel is
  a ghost.
- **Channel state badges.** `working` ok and live, `idle` accent (resting, not a
  warning), `stale` bad, `last-known` mute.
- **Machine facts stay machine.** Times are `4h ago`, ids `#4826`, slugs and
  statuses mono. The bot widget's "last seen" is a relative time, not a locale
  date.
- **Empty states.** Dashboard's two have no button: nothing on that page starts
  the bot or a session, and Restart bot is already in the header. A filter that
  hides everything gets its own line and **Clear filter(s)** (sessions, events,
  logs); logs' filtered-empty adds that action, the app has none today.
- **Errors say what failed.** Each replaces "An error occurred" with what broke,
  what to do, and the machine string in mono. **Retry** appears only where the
  app already has a retry (the log viewer, the segment error's **Try again**).
- **Not found.** `not-found.tsx` becomes the empty state (mascot, a line, **Back
  to sessions** as a button) rather than a bare link.
- **Reconcile.** Four count tiles; a count takes its colour only when non-zero
  (matched ok, missing bad, extra and mismatched warn).
- **Log viewer.** A phone row is time, level and message; the filter row scrolls
  sideways; Refresh is icon-only; the detail sheet is full width. Paused uses the
  warn dot, Following live the pulsing ok one.
- **JSON in the detail sheet.** Four inks: keys `accent-hi`, strings `ok`,
  numbers / `true` / `false` / `null` `ink`, punctuation `ink-2`.
- **Git statuses.** `StatusChip` becomes a `badge`; "Decrypt/parse-failed" is
  **Decrypt failed**, with a note saying what is blocked. The "name and email come
  from GitHub" block is the accent note (information, not a warning).
- **Global error.** `global-error.tsx` must stay inline-styled (no Tailwind, no
  Geist, no sprite, no component). The mockup draws it with inline styles and
  lists the literal values to copy from the `@theme` block. Its copy moves from
  "Something went wrong." to what happened and what to do.

## Mockup-only notes

- **`tdrList`.** The kit's `dataList` renders badges and plain values; tdr-code's
  rows carry links, an `ended` cell, inline confirms and a row error, so
  `tdrList` draws the same table / card pair from one column definition with the
  kit's classes.
- **`whitespace-pre-wrap`.** The builder re-indents its HTML, which `pre-wrap`
  would display, so a multi-line plan is drawn one `<p>` per line. The app keeps
  `pre-wrap`.
- **No `&` in a class.** Pug escapes it to `&amp;`, which Tailwind's scanner never
  matches, so a phone's taller select is `*:h-11!` rather than `[&>button]:h-11!`.
