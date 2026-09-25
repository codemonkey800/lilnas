# Voice

Most of "delightful, friendly UX" isn't animation. It's not being weird at
people.

Words are design material, not decoration. Before writing anything, ask what the
screen needs to say and how that helps someone get through it.

---

## The register

Write from the user's side of the screen, in plain sentences, active voice, and
sentence case. Assume the reader is competent and in a hurry.

|                          |                                                                       |
| ------------------------ | --------------------------------------------------------------------- |
| **Sentence case**        | "Save routine", not "Save Routine"                                    |
| **Active voice**         | "Radarr didn't answer", not "The request was not fulfilled"           |
| **Specific over clever** | "That link isn't one yt-dlp recognises", not "Hmm, that didn't work!" |
| **User's nouns**         | "access", not "ACL entry". "workout", not "session record"            |
| **No filler**            | Cut "please", "simply", "just", "successfully", "Oops"                |
| **One job per element**  | A label labels. An example demonstrates. Nothing does both.           |

lilnas is one person's server shared with friends, so the register is _a
competent friend who set this up for you_ — not a corporation, and not a mascot
doing bits. The pepe is the personality budget. Spend it there and let the words
be clear.

---

## Buttons

Name the action with a verb, and **keep that word through the whole flow.**

| Instead of                    | Write          |
| ----------------------------- | -------------- |
| Submit                        | Save routine   |
| OK                            | Got it         |
| Yes / No                      | Delete / Keep  |
| Confirm                       | Approve access |
| Cancel _(destructive dialog)_ | Keep it        |

The button that says **Publish** produces a toast that says **Published**. The
vocabulary of the interface is the signposting; consistency is how people learn
their way around without reading anything.

Never label a button with a noun ("Settings" is a link; "Save settings" is a
button).

---

## Errors

Errors explain what happened and what to do next. They don't apologise, they're
never vague, and they're not written in a person's voice.

```
✗  Error: request failed with status 500
✗  Oops! Something went wrong 😬
✗  We're sorry, an unexpected error occurred. Please try again later.

✓  Radarr didn't answer. It may be restarting — try again in a minute.
✓  That link isn't one yt-dlp recognises.
✓  Your session expired. Sign in again to pick up where you were.
```

**Structure:** what broke → why, if you know → what to do. The machine's error
code goes in `mono` after the sentence, or in a details disclosure — it's
useful, it's just not the headline.

> **Couldn't reach GitHub.** Retrying in 30s.
> `ETIMEDOUT api.github.com`

Never blame the user, and never say "invalid" when you can say what a valid one
looks like.

---

## Empty states

An empty screen is an invitation, never a dead end. Three parts, in order:

1. **What isn't here** — plain, no drama: "No routines yet"
2. **What happens when there is** — one sentence: "Build one and it'll show up
   here, ready to run."
3. **One thing to press.**

```
✗  No data available
✗  Nothing to see here! 👀
✗  You haven't created any routines. Click the button below to create one.

✓  No routines yet
   Build one and it'll show up here, ready to run.
   [ Create a routine ]

✓  No sessions running
   Start one from Discord and it'll appear here.

✓  Nothing downloaded yet
   Paste a link in the search bar and it'll queue up.
```

Distinguish **empty** (nothing exists yet) from **filtered-to-nothing** (things
exist, your filter hid them). The second gets a different line and a "Clear
filters" action, not a create action.

---

## Confirmations

Name the object and state the consequence — especially the part people fear.

```
✗  Are you sure you want to proceed?
✗  This action cannot be undone.

✓  Delete "Push day"? Its 14 logged sessions stay.
✓  Remove Sam's access? They'll be signed out of every service.
✓  Kill this session? Anything unsaved in it is lost.
```

If nothing bad happens, don't confirm at all — just do it and offer Undo. A
confirm dialog for a reversible action trains people to click through dialogs.

---

## Loading and progress

Say what's happening, not that something is happening.

```
✗  Loading…
✗  Please wait

✓  Fetching library from Emby…
✓  Downloading — 64%
✓  Waiting for Radarr to pick this up. Usually about a minute.
```

Under ~300ms, say nothing — a flash of "Loading…" is worse than a beat of
stillness.

---

## Machine strings stay machine

The type rule has a writing corollary: **don't translate machine facts into
prose.**

| Don't                                  | Do               |
| -------------------------------------- | ---------------- |
| "Last seen four hours ago"             | `4h ago`         |
| "The service is currently running"     | `running` chip   |
| "Ninety-five percent complete"         | `95%`            |
| "Located at slash storage slash media" | `/storage/media` |

Prose is for explaining and instructing. Facts are terse, monospaced, and
scannable. Mixing them makes both worse.

---

## Notifications and toasts

Toasts confirm. They don't explain, and they don't teach.

```
✓  Routine saved
✓  Access granted to Sam
✓  Copied
```

If a message needs more than about six words, it's a `Note`, not a toast.

---

## Capitalisation and punctuation

- Sentence case everywhere: headings, buttons, labels, menu items.
- No terminal period on labels, buttons, chips, table headers, or single-line
  toasts. Full sentences in body copy, notes and errors do get periods.
- App names lowercase as they appear in their subdomain: `swole`, `tdr-code`,
  `theater`. It's `lilnas`, never `LilNAS`.
- Numbers: numerals always (`3 sets`, not `three sets`). Units unspaced for
  time (`4h`, `30s`), spaced for weight (`185 lb`).
- Use a real em dash — like this — not `--`.

---

## Per-app tone

Same voice, different pace. All of these are the same person talking; they're
just in a different room.

| App        | Pace                                                                   | Example                                                                |
| ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `swole`    | Short, encouraging, glanceable. The user is mid-set and sweaty.        | "Beat the last one."                                                   |
| `tdr-code` | Terse and factual. The user is debugging and wants signal.             | "Session ended. 3 tool calls, 41s."                                    |
| `auth`     | Reassuring and clear about status. The user is locked out and anxious. | "You're in the queue. We'll let you in as soon as Jeremy approves it." |
| `download` | Brisk, transactional.                                                  | "Queued. It'll show up in the library when it's done."                 |
| `portal`   | Almost silent. It's a hallway.                                         | "Everything's here."                                                   |
| `theater`  | Atmospheric, minimal. Don't break the room.                            | "Waiting for everyone to sit down."                                    |

---

## A quick test

Read the string out loud. If you wouldn't say it to a friend standing next to
you, rewrite it.

"An unexpected error occurred while processing your request" is not something a
person says. "Radarr didn't answer — probably restarting" is.
