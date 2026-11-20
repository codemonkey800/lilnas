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
[`docs/designs/mockup-kit`](../../../designs/mockup-kit). Each page shows both
1280 and 390 behind the viewport switch, with every state as a captioned frame.

## Pages

| Page                         | Shows                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`start.html`](start.html)   | Pre-flight checklist; Apple ID and password (empty, submitting, wrong password, server low on space); waiting for a turn; code entry (empty, checking, wrong); signed in.                          |
| [`backup.html`](backup.html) | Queued, Apple preparing, downloading, reconnecting banner, review (normal and large), finishing, done (new Immich account, password shown, had an account), sign in again, paused, three failures. |
| [`admin.html`](admin.html)   | Backups table (rows, empty, loading, error; cards on a phone), then Existing libraries: presets list with Remove, and the add form (empty, validation errors, already linked, select open).        |

## Decisions

- **Written for family, not developers.** One thing to do per screen, a narrow
  560px column, plain words ("Apple is still preparing your library", not
  "iCloud sync pending"). The machine string only appears in mono under a failure.
- **The app bar is the doorplate** `icloud-backup.lilnas.io`, the signed-in email
  and an avatar. Admins get the kit's bar with two links (My backup, Backups).
- **One accent button per screen**: Continue, Sign in, Check code, Download,
  Open my photos, Sign in again, Try again, Add library. In the _large_ review
  the accent moves to **Not now** so the warning steers people to the safe choice.
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
- **Remove has no confirm dialog**: re-adding a preset is one form away, and
  nothing is deleted (voice.md: confirm only what can't be undone). It is a red
  outline, the only destructive control.
- **Admin is compact at 1280, comfortable at 390**, per DESIGN.md's density table.

## Layout

```
src/
  theme.css           three lines: the two per-project Tailwind lines, then the kit
  mixins/icloud.pug   bar, column, screen frame, steps, code cells, Immich panel
  mixins/start.pug    one mixin per sign-in screen, plus a dispatcher
  mixins/backup.pug   one dispatcher over every backup state
  mixins/admin.pug    table states, presets list, add form
  pages/*.pug         index, start, backup, admin: layout only
  data/*.mjs          copy and sample data, keyed by page name
```
