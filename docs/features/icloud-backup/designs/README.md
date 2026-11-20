# icloud-backup — UI mockups

**Open [`index.html`](index.html) in a browser.** No install, no server. Every
`*.html` here is self-contained: its CSS is inlined at build time.

Those `*.html` files are **generated**. Don't edit them — edit the Pug in
`src/` and rebuild, from the repo root:

```bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
pnpm mockups:lint   # prettier check over every designs src/ and the kit
```

Drawn in **Category Standard** from the shared kit,
[`docs/designs/mockup-kit`](../../../designs/mockup-kit). Every state is its
own Nexus review frame (a titled, captioned section), showing the screen at 1280
and 390 side by side. There is no viewport switch.

## Pages

| Page                         | Shows                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`start.html`](start.html)   | Pre-flight checklist; Apple ID and password (empty, submitting, wrong password, server low on space); waiting for a turn; code entry (empty, checking, wrong); signed in. |
| [`backup.html`](backup.html) | Queued, Apple preparing, downloading, reconnecting banner, finishing, done (new Immich account, password shown, had an account), sign in again, paused, three failures.   |
| [`admin.html`](admin.html)   | Backups table (rows, empty, loading, error; cards on a phone).                                                                                                            |

## Decisions

- **Written for family, not developers.** One thing to do per screen, a narrow
  560px column, plain words ("Apple is still preparing your library", not
  "iCloud sync pending"). The machine string only appears in mono under a failure.
- **The app bar is the doorplate** `icloud-backup.lilnas.io`, the signed-in email
  and an avatar. Admins get the kit's bar with two links (My backup, Backups).
- **One accent button per screen**: Continue, Sign in, Check code,
  Open my photos, Sign in again, Try again.
- **Sign-in is three screens with a step marker**, not one long form. Waiting for
  a turn sits in step 2 because it happens right after Sign in.
- **The code cells show bullets, never digits**, and the Apple ID is
  `nobody@example.invalid`. Every email on the admin page is on `example.com`
  or `example.invalid`; the temporary password is a made-up phrase.
- **Only a live backup pulses**: Downloading and Finishing wear the live dot.
  Reconnecting swaps it for a still amber dot and a banner under the app bar.
- **Failed is one screen with a reason slot** (a red note). Apple refused links
  back to the pre-flight (`start.html#preflight`), timed out goes back to
  sign-in, generic offers Try again.
- **Admin is read-only**: a table and nothing to change. Someone whose iCloud
  folder or Immich library already existed signs in like anyone else; the service
  finds both by their email and the download skips what is there, so there is no
  screen or form for it.
- **Admin is compact at 1280, comfortable at 390**, per DESIGN.md's density table.

## Layout

```
src/
  theme.css           three lines: the two per-project Tailwind lines, then the kit
  mixins/icloud.pug   bar, column, screen frame, steps, code cells, Immich panel
  mixins/start.pug    one mixin per sign-in screen, plus a dispatcher
  mixins/backup.pug   one dispatcher over every backup state
  mixins/admin.pug    table states
  pages/*.pug         index, start, backup, admin: layout only
  data/*.mjs          copy and sample data, keyed by page name
```
