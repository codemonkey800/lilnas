---
nexus-plan: 2
title: 'auth admin: show invited people who have not signed in yet'
branch: feat/auth-invited-people
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/auth lint && pnpm --filter @lilnas/auth type-check
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && cd apps/auth && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest src/admin src/app/admin src/grants src/verify --maxWorkers=2
  - pnpm --filter @lilnas/cli build && pnpm mockups && pnpm mockups:lint
parallel: 2
review: per-phase
commit-style: 'conventional, scope required, e.g. feat(auth): …, test(auth): …, docs(auth): …'
---

# auth admin: show invited people who have not signed in yet

## Goal
On the lilnas auth admin dashboard (`https://auth.lilnas.io/admin`, `apps/auth`), "Add a person"
with an email that has never signed in stores the access as pending rows in
`pre_authorized_grant`. The People table lists only `user` rows, so that person is invisible
until their first sign-in, and the toast says "Access granted to <email>" although nothing was
granted yet. Real case: `erlyned@gmail.com` was added for `immich.lilnas.io` and
`icloud-backup.lilnas.io` on 2026-11-23 and never appeared.

After this run:
- Invited people appear in the People table with an "Invited" badge, their pending services
  and the date they were invited. Search and the counts include them.
- An admin can edit an invited person's pending services and cancel the invite.
- The Add-person toast says "Invited <email>" when the email has no account and
  "Access granted to <email>" when it has one.

Nothing is pushed or deployed by this run.

## Decisions
- **A state in the People table, not a separate section** (Jeremy, 2026-11-23). The mockup
  shows the separate section once, as an alternative, and the mockup review (H1) settles it.
- **Two new backend routes**: `GET /admin/invites` (pending invites grouped by email) and
  `POST /admin/invites/remove` (deletes named pending rows). Adding services to an invite
  reuses `POST /admin/users/pre-authorize`.
- **`pre-authorize` reports which branch ran** (`outcome: 'invited' | 'granted'`), so the
  toast is decided by the server, not guessed by the client.
- **`invites/remove` reports the hosts it actually removed.** If the person signed in a moment
  earlier, their pending rows are already real grants and the removal deletes nothing; the
  dashboard then says so instead of claiming the invite was cancelled.
- **Invited rows have no Block, Sign out everywhere, Remove access or Discord controls**: no
  account exists yet.
- **The invited dialog is its own component** (`edit-invite-modal.tsx`), not a branch inside
  `EditAccessModal`, which is keyed on a user id throughout.
- **Add person with no service selected becomes a field error** (planner's addition, open to
  veto in H1). Today it makes no call and still toasts "Access granted".
- **First sign-in is unchanged.** The binding already deletes the pending rows; the invited row
  is replaced by a normal row on the dashboard's next refresh.
- **No push, no deploy.** Jeremy handles rollout.

## Context
- Repo: pnpm monorepo. This run touches `apps/auth` (`@lilnas/auth`: NestJS backend in
  `src/admin`, `src/grants`, `src/verify`; Next.js admin page in `src/app/admin`) and the auth
  mockups in `docs/features/auth/designs`.
- Backend flow: `src/admin/admin.controller.ts` (thin routes behind `AdminGuard`, bodies parsed
  with zod schemas from `src/admin/admin.dto.ts` through `parseBody`) calls
  `src/admin/users.service.ts` (`UsersService`: one `BEGIN IMMEDIATE` transaction per mutation
  with every read inside it, then `AccessCacheService` updates, then
  `notifyBus.publishAdminChange()` only when something changed). Table access is in
  `src/grants/grants.repo.ts`; emails go through `normalizeEmail` (`src/admin/normalize-email.ts`).
- Pending invites are rows of `pre_authorized_grant` (`id`, `email`, `service_host`,
  `created_at`; `src/db/schema.ts`). `AccessCacheService` (`src/verify/access-cache.service.ts`)
  mirrors them in memory (`addPreAuthorization`, `removePreAuthorization`) and
  `bindPreAuthorizedGrant` turns them into grants on the person's first `/verify`.
- Frontend flow: `src/app/admin/page.tsx` fetches through `require-admin.ts` and renders
  `admin-dashboard-client.tsx`; mutations are Server Actions in `actions.ts`. The dashboard
  keeps no local copy of server data: each mutation publishes an SSE event and the page
  re-fetches via `router.refresh()`.
- Conventions: long header comments that explain why; mutations send explicit deltas, never a
  full-set resubmit; UI from `@lilnas/ui` primitives (raw palette utilities are lint errors, see
  `DESIGN.md`); class names combined with `cns()`; avoid `any`.
- Tests: Jest, in `__tests__` beside the source. Backend specs build a real in-memory SQLite DB
  (see `src/admin/__tests__/user-management.spec.ts`); the dashboard spec
  (`src/app/admin/__tests__/admin-dashboard-client.spec.tsx`) mocks `src/app/admin/actions`.
  Run only the specs you touch, from `apps/auth`:
  `NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest <paths> --maxWorkers=2`
  and read the `Tests:` line. Never run Jest without `--maxWorkers=2` and never run the whole
  repo's suites: this machine is the production server and has nearly run out of memory that way.
- Lint and types: `pnpm --filter @lilnas/auth lint` (`lint:fix` to format) and
  `pnpm --filter @lilnas/auth type-check`, after
  `pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build`.
- Mockups: edit Pug and data under `docs/features/auth/designs/src`, build with
  `pnpm --filter @lilnas/cli build && pnpm mockups`, commit the generated `*.html`. Read
  `docs/designs/mockup-kit/README.md` first.
- Never touch production: no `docker compose` against the `lilnas` project, no reads or writes
  of `/storage/app-data/lilnas-auth`, no `git push`, no deploy.

## Done means
- The task's behaviour is implemented as its body describes, in the files it lists.
- Tests cover each case the task's body names, written in the style of the neighbouring specs.
- The three `checks:` pass.
- New and changed code has header comments that explain why, in the style of the file it is in.
- Every new mutation reads inside the same `BEGIN IMMEDIATE` transaction it writes under.
- No raw palette utilities, no `any`, class names combined with `cns()`.
- Existing behaviour, test ids and accessibility contracts are unchanged unless the task says
  otherwise.
- Nothing was pushed or deployed, and no production data was read or written.

## Planner notes
- Investigation (session "Added User Missing From People Table", 2026-11-23): prod DB had two
  `pre_authorized_grant` rows for `erlyned@gmail.com` and no `user` row. `GET /admin/users`
  reads `listUsersWithGrantHistory` (`user.everGrantedAt IS NOT NULL`) only.
- `bindPreAuthorizedGrant` does not call `publishAdminChange()` (`AccessCacheService` has no
  bus). An open dashboard therefore moves the person from Invited to a normal row on its 30 s
  poll floor (`POLL_FLOOR_MS` in `admin-dashboard-client.tsx`), not instantly. Left as is;
  a follow-up could publish from `VerifyService` after a successful bind.
- Window case: a person who has signed in with Google but not yet hit `/verify` has a `user`
  row and pending invite rows. They still show as Invited (their user row has no grant
  history). Adding a service then takes the existing-user branch (`outcome: 'granted'`), so
  the same email can briefly have a normal row and an invited row. Rows are keyed
  `invite:<email>` to allow that; the invite binds on their next visit to an ungranted host.
- `RemoveInvitesBodySchema` normalizes hosts but does not run `HostMatcherSchema`'s pattern
  check: a stored rule must stay removable even if `REDIRECT_ALLOWED_SUFFIX` later changes.
- Checks verified at base on 2026-11-23: check 1 exit 0; check 2 23 suites, 452 tests, 5 s;
  check 3 exit 0 with a clean tree afterwards (the mockup build is deterministic).
- Live check (T4) boots the backend on the host with a throwaway DB and
  `scripts/cookie-rig/mint-session.mjs`; it uses an access-rule host (`*.dev.localhost`) so the
  service registry, which reads compose files at container paths, is never consulted.
- Not planned: folding the invited state into `docs/features/auth/designs/admin.html` (the
  canonical admin mockup); the new `invited.html` page carries it.
- No run model is set; tasks use the Start screen's choice.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-11-23 · T2 · done
Endpoints for the frontend task:
- GET /admin/invites -> AdminInviteEntry[] ({ email, serviceHosts, createdAt }).
- POST /admin/invites/remove, body { email, serviceHosts } -> { ok: true, removed: string[] }.
  An empty `removed` means nothing was pending, e.g. the person already signed in and the rows were
  bound into grants, so the UI should say so rather than report success.
- POST /admin/users/pre-authorize now returns { ok: true, outcome: 'invited' | 'granted' }.
Mockups: `pnpm mockups` produced no changes (nothing to commit). No checks failed.

### 2026-11-23 · T1 · done
Frame titles in order: 01 People with invited rows; 02 Search matches an invited person; 03 Edit access for an invited person; 04 Cancel invite · confirm; 05 Add person · nothing selected; 06 Toasts; 07 Alternative · separate Invited section.

Badge tone: accent. ok implies access, warn is the Pending tile's "needs you", mute is "No access" and the service badges; accent is the only tone left reading as "in progress". It shares a hue with Admin; the label and the dash in the Discord column separate them.

Copy changed or added versus the brief: the warning toast is drawn as title "erlyne@example.com has signed in." plus detail "Edit their access from their row."; the frame 03 caption proposes "Remove invite" (with "Keep invite" and toast "Invite removed") in place of "Cancel invite", while frames 03 and 04 are drawn with the brief's copy; frame 07 draws a fourth "Invited" tile (People 3, Granted 2, Invited 2, Pending 0), frame 01 keeps three tiles with People 5 and Granted 2. The invited row's Discord cell is an em dash with sr-only text "Available after they sign in" (not "Not linked"); the person cell shows the email in mono with "Invited Nov 23" beneath it.

Deviation from the brief's git-status rule: admin.html, home.html, login.html, pending.html and blocked.html in docs/features/auth/designs are regenerated. The auth project builds one Tailwind stylesheet from all its pages, so adding a page with new utilities (max-w-[1760px], mb-14, grid-cols-4, ...) adds rules to every page's inlined CSS. Their diffs are pure CSS additions (34 lines each, zero deletions), no markup or rendering change; I committed them so pnpm mockups stays idempotent and the tree is clean, as icloud-backup did when it added review frames. The statTiles class order is preserved so admin.html markup is byte-identical.

Shared mixin changes in src/mixins/auth.pug: authCell person handles rows without a name; authCell discord handles row.invited; statTiles(stats, view) draws 4 tiles as 4 columns (2x2 at 390); addPersonDialog takes serviceError; new inviteEditDialog. Existing calls render unchanged.

Checked at 1800px in headless Chromium: all frames lay out both viewports side by side with no horizontal overflow. No <script> in invited.html. Not run: the apps/auth lint/type-check/jest checks, since nothing under apps/auth changed.

### 2026-11-23 · T3 · done
- `fetchAdminInvites()` in `require-admin.ts` calls GET /admin/invites and returns `AdminInviteEntry[]` in backend order. `AdminInviteEntry` is re-exported from require-admin.
- `preAuthorizeUsers(email, serviceHosts)` returns `{ ok: true; outcome: 'invited' | 'granted' }`. Existing callers ignore the return value and are unaffected.
- `removeInvites(email, serviceHosts)` returns `{ ok: true; removed: string[] }`. An empty `removed` is a success response meaning nothing was pending (the person already signed in, so the rows were bound into grants). The UI should say so rather than report success.
- `removeInvites` shape-checks its arguments before sending, with no backend call on failure: the email must be a string of 1–320 characters containing `@`, and the hosts a non-empty array of non-empty strings. The thrown errors are `lilnas-auth: invalid email` and `lilnas-auth: invalid service hosts`.
- The validators `requireEmail` and `requireServiceHosts` stay module-private, because `actions.ts` is a 'use server' file and may only export async functions.
- All three checks passed: lint and type-check clean, 492 Jest tests in 23 suites passing, mockups build and lint clean with no generated changes.

### 2026-11-23 · T4 · done
Live check of the invite routes passed; no defects. Every call matched the task's expectations (calls and bodies are in the message above).
The only deviation from the steps: step 1 also needed `pnpm --filter @lilnas/ui build`, because `build:backend` type-checks the whole app and failed with TS2307 on `@lilnas/ui` without it.
POST routes return 201 (Nest default), not 200. serviceHosts in GET /admin/invites are sorted alphabetically.
Temp dir, temp files and the server process were removed. No repository files changed and nothing was committed.

No commits: nothing to integrate.

### 2026-11-23 · H1 · changes requested
Changes requested at round 1: 1 comment, sent to R1.

Design review of `docs/features/auth/designs/invited.html`, round 1:

1. pin on <div> "07 Alternative · separate Invited section" in scene "Toasts"
   - selector: `#section > header:nth-of-type(1) > div:nth-of-type(1)` at fx 0.52, fy 0.43
   - **user:** the combined table looks better, so we can remove this mockup
   - screenshot 1 attached

### 2026-11-23 · R1 · done
Resolved the one thread (dt-c86cc0b4…) on frame 07. invited.html now has frames 01-06; the earlier frame order and captions are otherwise unchanged. Frame 03/04 captions about "Remove invite" are untouched. The four-tile statTiles support in mixins/auth.pug stays, since it is shared and harmless.

### 2026-11-23 · H1 · approved
Approved.

Approved at round 2.

### 2026-11-23 · Phase 1 · review cycle 1
Pass 1 (T2): T2's backend for invites (repo read, RemoveInvitesBodySchema, removeInvites in one BEGIN IMMEDIATE transaction, the pre-authorize outcome, GET /admin/invites, POST /admin/invites/remove) matches the task body, and every named test case is present and would fail if the behaviour broke. No defects found.
Pass 2 (T1): T1 is a mockup-only slice (Pug, data, generated HTML). The mixin changes are additive and leave existing pages' markup unchanged. Frames 01–06 render as briefed in both viewports; frame 07 was spot-checked through its sources only. No defects found.
Pass 3 (T3): T3 adds fetchAdminInvites, removeInvites with argument checks before any request, and a preAuthorizeUsers that now returns the backend's outcome. All three match the backend routes, and every test case the task names is present. No defects found.
Pass 4 (R1): Pass 4 (R1) only removes the frame 07 'separate Invited section' alternative from the invited mockup: Pug mixin, the data exports, captions, README row and the regenerated HTML. It is a clean deletion that leaves no references behind in the mockup sources.
Seams pass: Seams pass: every boundary between T2 (backend) and T3 (frontend data layer) agrees: routes, methods, request bodies, response shapes and the shared AdminInviteEntry type. T1 is a static mockup, so no code consumes it; its data needs (email, pending hosts, invited date) map onto AdminInviteEntry.

Spec check:
- unverifiable: open invited.html in a browser at 1800 px wide and check each frame renders both viewports without overflow (docs/features/auth/designs/invited.html) — Visual layout is checked at the H1 design review; the task note says headless Chromium was used.
- unverifiable: Remove the separate Invited section alternative (H1 round 1 change request) (docs/features/auth/designs/invited.html) — Whether the rendered page now reads well with six frames is for a person to judge at the H task.

Declined to judge:
- RemoveInvitesBodySchema accepts a whitespace-only host, which normalizes to '' and matches nothing — Harmless: removal returns [] and publishes nothing, which the task says is the right result for a host that isn't pending.
- The controller's z.string().email() rejects an email with leading or trailing spaces before normalizeEmail runs — Behaves the same as PreAuthorizeBodySchema. The task's case-insensitivity case is at the service level, where a test covers it.
- Five existing auth pages (admin, home, login, pending, blocked) regenerated, against the brief's rule that only invited.html and index.html change — The diff holds only added CSS rules, because the project builds one shared stylesheet; there is no markup change. The task note explains it, and the human design review (H1) judges it.
- Copy choices: 'Remove invite' proposed in a caption, the warning toast split into title and detail, an em dash with sr-only text in the invited Discord cell — Design copy for the human mockup review, not code defects.
- On mobile, Tomas's six services plus the rule collapse to '+3', hiding the *.dev.lilnas.io rule — The existing services cell already truncates this way; the brief does not ask for the rule to be visible.
- preAuthorizeUsers restates the `'invited' | 'granted'` union inline instead of `import type`-ing PreAuthorizeOutcome from admin.controller — Minor drift risk, but the task's interface spells the inline union. Style only, not a defect.
- requireEmail accepts a 320-character email even though RFC addresses are shorter in practice — The task asks for exactly this. The backend's zod schema is the authority on whether an email is valid.
- README.md table row for invited is now shorter than the padded neighbouring rows — Markdown table formatting only. Prettier may re-pad it, and no check results were recorded.

Checked:
- Imports used by removeInvites and the new schema exist — apps/auth/src/admin/users.service.ts imports; apps/auth/src/grants/host-matcher.ts:40: findPreAuthorizedGrantsByEmail and deletePreAuthorizedGrant were already imported; normalizeHostMatcher is exported and does trim + lowercase.
- removeInvites leaves the in-memory cache out of step with the DB, so a removed host still binds on first sign-in — apps/auth/src/verify/access-cache.service.ts:239-343: bindPreAuthorizedGrant binds from the in-memory preAuthorizedByEmail. removePreAuthorization re-normalizes the email and is called synchronously after commit (better-sqlite3 is sync, so nothing runs in between). The DB and memory stay in step.
- Duplicate (email, host) rows make removed list a host twice — apps/auth/src/db/schema.ts:256: A unique index on (email, service_host) rules out duplicates.
- Changed return type of preAuthorize/preAuthorizeMany breaks a caller — grep across apps/auth/src: The only production caller is AdminController.preAuthorize, which now uses the value. The kind values are 'granted' and 'pre-authorized', and the mapping is right.
- The DTO spec's outside-suffix test passes even if HostMatcherSchema were used — apps/auth/src/admin/__tests__/admin.dto.spec.ts: REDIRECT_ALLOWED_SUFFIX is not set in that spec, so HostMatcherSchema would throw or reject on a wildcard. The test would fail, so it tells the truth.
- statTiles signature change (new view parameter) breaks existing callers — docs/features/auth/designs/src/pages/admin.pug:30,38: Callers pass only stats; three tiles still give grid-cols-3, so markup is unchanged.
- authCell person branch now depends on v.name; existing rows could lose their avatar or name — docs/features/auth/designs/src/data/admin.mjs: Every existing person and blocked row has a name, so they take the original branch.
- addPersonDialog's new serviceError argument changes existing dialogs — docs/designs/mockup-kit/ui.pug:320 (field mixin): An undefined third argument renders no error, so existing calls are unchanged.
- Granted count of 2 in the stat tiles does not match the real dashboard — apps/auth/src/app/admin/admin-dashboard-client.tsx:418: Granted counts users with at least one service: the Admin row and Jane make 2, which matches.
- Edit-invite dialog shows the wrong services or controls that need an account — docs/features/auth/designs/invited.html (frame 03): Emby and Immich are checked; no Discord field, Sign out everywhere or Remove access; Cancel invite, Cancel and Save access are present.
- Script, or unrendered or undefined values, in the generated page — docs/features/auth/designs/invited.html: No <script>; no 'undefined', 'NaN' or '[object' strings.
- AdminInviteEntry is exported from admin.controller and the wire shape matches the require-admin test fixtures — apps/auth/src/admin/admin.controller.ts: Exported type {email, serviceHosts, createdAt}. GET /admin/invites returns AdminInviteEntry[].

### 2026-11-23 · T5 · done
- Followed the approved mockup: rows in the People table, because H1 approved it and the separate "Invited" section was already removed from it. `stat-tiles.tsx` is unchanged because frame 01 keeps three tiles.
- `page.tsx` adds `fetchAdminInvites()` to the `Promise.all` and passes `initialInvites`, which is required on `AdminDashboardClientProps`.
- `admin-dashboard-client.tsx` uses `initialInvites` directly as `invites`, with no local state. It builds `PersonRow[]` from the active users plus the invites, filters by email on the search term, and sorts by email with `localeCompare`.
- Users are listed before invites, so when a user and an invite share an email the account stays above its leftover invite.
- Counts: the People tile is `users.length + invites.length` and the section count is `rows.length`. Granted is unchanged. The empty states are unchanged, and a search that matches only an invite shows that row.
- `people-list.tsx` takes `rows: PersonRow[]` instead of `users`. `PersonRow` has `key` = `user.id` for users and `invite:${email}` for invites, so a user and an invite with the same email render as two rows without a key clash.
- `personColumns`, `PersonCell` and `PersonStatusBadge` are unchanged, so `blocked-panel.tsx` is untouched.
- An invited row shows the following, as in the mockup:
  - an initials avatar, the email in mono, and "Invited <toLocaleDateString()>" beneath it in a `suppressHydrationWarning` span;
  - an accent "Invited" badge;
  - `ServiceBadges` from `serviceHosts`;
  - a dash with sr-only text "Available after they sign in" in the Discord column;
  - an empty Actions cell, with no Block and no Edit access.
- The date renders as the locale date (for example 11/23/2026) rather than the mockup's "Nov 23", because the task asked for `toLocaleDateString()`.
- I did not touch the mockup's proposal to rename the cancel action to "Remove invite" (frame 03 caption). That belongs to the next task, which adds Edit access for invites and its dialog.
- Header comments in `admin-dashboard-client.tsx`, `people-list.tsx` and `page.tsx` now explain why invites exist: pending rows live in `pre_authorized_grant`, not in `user`, until the first sign-in binds them into grants.
- New spec describe block "invited people in People" covers each case the task body lists. The existing renders now pass `initialInvites={[]}`.

### 2026-11-23 · T6 · done
- H1 approved with no comments, so the brief's copy stands: "Cancel invite", "Keep invite", "Invite cancelled". The mockup's "Remove invite" proposal was not adopted.
- Add-person with nothing selected now shows the field error "Pick at least one service or rule." under the service grid, with no call and no toast. The verdict did not say to keep the old behaviour.
- The Add-person toast follows `outcome`: "Invited <email>" or "Access granted to <email>".
- EditInviteModal is keyed `inviteModalInvite?.email ?? 'no-invite'`, not `'none'` as the brief says. The brief's key duplicates EditAccessModal's `'none'` key as a sibling and React warns; T5's key-warning test caught it.
- The warning toast is a single string, "<email> has signed in. Edit their access from their row.", with tone `warn`. The mockup draws a title plus a detail line, but `showToast` takes one string.
- Save sends adds first (`preAuthorizeUsers`) and then removals (`removeInvites`), each only when non-empty. If the removal throws after the add succeeded, the dialog stays open with the error, and retrying re-sends the add.
- Saving with nothing selected opens the Cancel-invite confirm and sends nothing. Cancel-invite is handled in the dashboard's `handleCancelInvite` via `runAction`; it toasts "Invite cancelled" when `removed` is non-empty and the warning toast otherwise, then closes the dialog.
- `visibleServiceHosts` is exported from `edit-access-modal.tsx`.
- The invited row's "Edit access" button is in `people-list.tsx` (`onEditInvite`); there is still no Block.
- Mockups were not changed; `pnpm mockups` produces no diff.

### 2026-11-23 · Phase 2 · review cycle 1
Pass 1 (T5): T5 adds invited rows to the People table as the task asks: invites are used straight from props, merged with active users, searched on email, sorted by email, given distinct keys, and counted in the People tile and the section count but not in Granted. I found no defects, and the tests cover every case the task body names.
Pass 2 (T6): T6 adds the edit-invite dialog (sends only the changes, warns when the person has signed in, Cancel invite asks to confirm first), the invited row's Edit access button and the outcome-based Add-person toast. All of it matches the task body, and each test the task names is present. One P2: a header comment that gives the wrong key.
Seams pass: Seams pass over T5 (invited rows) and T6 (edit/cancel invite, toast): the shared type, the edit callback, the action return shapes and the newly exported helper all agree across the two tasks. No cross-task disagreements found.

Notes:
- F1 · P2 · Header comment gives a mount key the code doesn't use — apps/auth/src/app/admin/edit-invite-modal.tsx:72

Spec check:
- unverifiable: Follow the approved mockup for layout, badge tone, copy and counts (docs/features/auth/designs/invited.html) — Mockups are excluded from this diff; a person should compare the accent badge, the dash in the Discord column and the 'Invited <date>' subline against the approved frame.
- unverifiable: Follow it for layout and copy (approved mockup invited.html) (apps/auth/src/app/admin/edit-invite-modal.tsx) — The mockup isn't in this diff. Someone should compare the dialog's layout, and the warning toast's single line where the mockup has a title plus a detail line, against invited.html.

Declined to judge:
- Invited date renders as a locale date (11/23/2026) rather than the mockup's 'Nov 23' — The task body explicitly asks for toLocaleDateString(), and the task note says so.
- A user and an invite with the same email count twice in the People tile and the section count — The task body asks for both rows to render and for the tile to be users.length + invites.length.
- Tests rely on DOM structure (the tile's label sibling, the heading's parent, the bg-accent-ghost class) — They are brittle but still fail if the behaviour breaks; style only.
- Cancel invite (and Save with nothing selected) removes invite.serviceHosts as it was when the dialog opened. A host another admin added while the dialog was open stays pending, yet the toast still says 'Invite cancelled'. — The task says to call removeInvites(email, invite.serviceHosts). It only happens when two admins edit at once.
- If removeInvites throws during Cancel invite, the error goes to the dashboard's error banner behind the open dialog, not into the dialog. — The task says to handle it through runAction, like handleRemove, which behaves the same way.
- If the add succeeds and the removal then throws, a retry sends the add again. — The task notes say so, the header comment explains why adds go first, and preAuthorizeUsers adding an already-pending host does no harm.
- The invited row's Edit access button is not disabled while isPending. — The user row's Edit access button isn't either, and the dialog's own controls are disabled.
- Duplicated 'Invited <date>' formatting: invitedLine() in edit-invite-modal.tsx and InvitedPersonCell in people-list.tsx — Both use new Date(createdAt).toLocaleDateString() and render the same text today; duplication only, no disagreement.

Checked:
- AdminInviteEntry shape and fetchAdminInvites exist at T5's commit — apps/auth/src/admin/admin.controller.ts, apps/auth/src/app/admin/require-admin.ts: {email, serviceHosts, createdAt: ISO string}, re-exported, fetched from /admin/invites; it matches how people-list uses it.
- PeopleList prop rename from users to rows breaks another consumer — git grep PeopleList in apps/auth/src: The only consumer is admin-dashboard-client.tsx, which was updated.
- Search on invites differs from search on users — apps/auth/src/app/admin/admin-dashboard-client.tsx filteredUsers: Both trim and lowercase the term and use includes on the lowercased email, so they match.
- The section-count test reads the wrong element — apps/auth/src/app/admin/section-head.tsx: The heading's parent div holds only the h2 and the count pill, so the assertion is meaningful.
- blocked-panel.tsx still uses personColumns for AdminUserEntry rows — apps/auth/src/app/admin/people-list.tsx: personColumns, PersonCell and PersonStatusBadge are unchanged.
- Server Action signatures the modal and dashboard depend on — apps/auth/src/app/admin/actions.ts: preAuthorizeUsers returns {ok, outcome: 'invited'|'granted'} and removeInvites returns {ok, removed: string[]}, matching every place that reads them.
- Where a failed Cancel invite shows its error — apps/auth/src/app/admin/admin-dashboard-client.tsx runAction: It sets actionError on the dashboard, the same path handleRemove uses. On failure closeInviteModal is skipped, so the dialog stays open.
- Save button can be clicked twice while a save is running — packages/ui/src/button/button.tsx: loading makes the button inert, so it can't be clicked while isPending.
- Invited date drawn differently in the dialog and the row — apps/auth/src/app/admin/people-list.tsx InvitedPersonCell: Both use new Date(createdAt).toLocaleDateString(). The dialog only renders after a click, so there is no server/client hydration mismatch.
- Edit access test ids and accessibility contracts unchanged — apps/auth/src/app/admin/people-list.tsx: The user-row actions are untouched. The invited row only gains an Edit access button, and the old 'no buttons' assertion was narrowed to Block.
- AdminInviteEntry shape consumed by T5 row and T6 modal — apps/auth/src/admin/admin.controller.ts:98, people-list.tsx, edit-invite-modal.tsx: email/serviceHosts/createdAt used consistently; createdAt is ISO and both sides parse it with new Date().
- Invite row Edit access → modal wiring — people-list.tsx:259, admin-dashboard-client.tsx:492,565,617: onEditInvite(invite: AdminInviteEntry) matches openInviteModal; the modal is keyed by email and the row key 'invite:${email}' is separate, so the two keys don't collide.

### 2026-11-23 · Final report
The run finished with every task integrated on `feat/auth-invited-people`. Nothing was pushed or deployed. T4 used a throwaway database.

Tasks:
- T1 mockup: done, `c9e4058c`
- H1 mockup review: round 1 asked to drop frame 07; approved at round 2. No commit.
- R1 remove frame 07 from invited.html: done, `30954c82`
- T2 backend (list and remove invites, pre-authorize outcome): done, `78419662`
- T3 frontend data layer: done, `4c77e8a2`
- T4 live HTTP check of the invite routes: done. No repo changes, no commit.
- T5 People table: invited rows, search, counts: done, `816b5e57`
- T6 edit and cancel an invite, Add-person toast: done, `db9fe836`

Review:
- Phase 1 (T1, T2, T3, R1): four passes and a seams pass, no defects.
- Phase 2 (T5, T6): two passes and a seams pass, one P2 finding (F1), not fixed.

Deviations:
- T1 regenerated admin.html, home.html, login.html, pending.html and blocked.html. The brief said only invited.html and index.html should change. Each diff is 34 added CSS lines with no markup change, because the auth project builds one shared stylesheet.
- Copy: the app says "Cancel invite", "Keep invite" and "Invite cancelled", as H1 approved. The mockup captions for frames 03 and 04 still say "Remove invite", so the mockup and the app disagree.
- The warning toast is one string: "<email> has signed in. Edit their access from their row." The mockup draws a title and a detail line.
- The invited date uses toLocaleDateString (11/23/2026), not the mockup's "Nov 23", as the brief asked.
- The edit-invite dialog is keyed `'no-invite'`, not `'none'`, because `'none'` duplicates EditAccessModal's key as a sibling and React warns. See F1.
- Add-person with no service selected shows the field error "Pick at least one service or rule." It makes no call and shows no toast. This was the planner's addition; H1 raised no objection.
- Frame 07 (separate Invited section) was removed per H1 round 1, so invited.html has six frames.
- T4 needed `pnpm --filter @lilnas/ui build` before the backend build. POST routes return 201.
- admin.html, the canonical admin mockup, still shows no invited rows, as planned. The invited state lives only in invited.html.

Checks:
- T1, T2 and T3 passed their integration checks: lint, type-check, 492 Jest tests in 23 suites, and mockups build and lint clean.
- T5 and T6 squashed with no integration checks recorded. Their task-level checks reported ok.
- The run-level checks were not re-run after the last squash.

Unfixed review findings:
- F1 (P2), `apps/auth/src/app/admin/edit-invite-modal.tsx:72`: the header comment says the parent mounts the dialog with `key={invite?.email ?? 'none'}`. The code uses `'no-invite'` (`admin-dashboard-client.tsx:618`). Comment only; no behaviour change. Still present at the end of the run.

Open questions and follow-ups:
- First sign-in is not live. `bindPreAuthorizedGrant` does not publish an admin change, so an open dashboard moves the person from Invited to a normal row on its 30 s poll. The planner suggests publishing from `VerifyService` after a successful bind. Not done.
- A person who has signed in with Google but has not yet hit /verify has a user row and pending invites. They show as Invited, and adding a service can give the same email two rows until their next visit. Designed in, not fixed.
- Cancel invite removes only the hosts captured when the dialog opened. If another admin adds a host meanwhile, that host stays pending, but the toast still says "Invite cancelled". Declined in review; it needs two admins editing at once.
- Retrying a Save after the add succeeded but the removal threw re-sends the add. Harmless, because adding an already-pending host does nothing.
- Nothing checked the dashboard rows or the edit dialog in a browser. The review marked the visual comparison with invited.html unverifiable. T1's 1800px check covers only the mockup.
- The mockup and app copy differ (see Deviations). Decide whether to update the invited.html captions.

### 2026-11-23 · Landed
Squash-merge of `feat/auth-invited-people` into `main` as `feat(auth): show invited people on the admin dashboard`, authored as Jeremy Asuncion.
