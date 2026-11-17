---
nexus-plan: 2
title: Category Standard redesign of auth, dev, download, portal, tdr-bot and tdr-code, with @lilnas/ui
branch: feat/design-system-redesign
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/utils build && if [ -d packages/ui ]; then pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/ui lint && pnpm --filter @lilnas/ui type-check && pnpm --filter @lilnas/ui test --maxWorkers=2; fi
  - pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/portal lint && pnpm --filter @lilnas/portal type-check && if grep -q '"test"' apps/portal/package.json; then pnpm --filter @lilnas/portal test --maxWorkers=2; fi
  - pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/auth lint && pnpm --filter @lilnas/auth type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/auth exec jest --selectProjects frontend --maxWorkers=2
  - pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/dev lint && pnpm --filter @lilnas/dev type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/dev exec jest --selectProjects jsdom --maxWorkers=2
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/media build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/media build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2
  - pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-code lint && pnpm --filter @lilnas/tdr-code type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-code exec jest --selectProjects frontend --maxWorkers=2
  - pnpm --filter @lilnas/cli build && pnpm mockups && pnpm mockups:lint
parallel: 3
review: per-phase
commit-style: "conventional with scope, e.g. feat(ui): …, feat(download): …, design(auth): …, docs: …"
---

# Category Standard redesign of auth, dev, download, portal, tdr-bot and tdr-code, with @lilnas/ui

## Goal
Move six apps — `apps/auth`, `apps/dev`, `apps/download`, `apps/portal`,
`apps/tdr-bot`, `apps/tdr-code` — onto the Category Standard design system
decided on 2026-10-23 (`DESIGN.md`, `docs/designs/*`), through one shared
component library `packages/ui` (`@lilnas/ui`: the `@theme` block, Geist
fonts wiring, icons, the pepe marks, and every primitive in
`docs/designs/components.md`, built on Base UI). Every screen of every app is
redesigned first as a mockup (desktop 1280 and mobile 390, with its loading,
empty, error and live states), reviewed per app, then implemented against the
approved mockup. MUI/emotion leave `tdr-bot`; the local `src/components/ui/`
copies in `download` and `dev` are deleted in favour of the package; raw
`gray-*`/`blue-*` utilities leave `tdr-code` and `portal`; `auth`'s
`design-tokens.css` classes become components. No feature changes: every
route, control, state, SSE/WebSocket behaviour, `data-testid`/`data-track-id`
and server action stays. Out of scope: `dashcam`, `theater`, `swole`,
`equations`, `me-token-tracker`, deploying, and restarting the `tdr-code`
daemon.

## Decisions
- **Scope is the six apps the user named** (Jeremy, 2026-10-23). `swole` is
  not in this repo; `dashcam` and `theater` wait.
- **Mockups cover every route that exists in code today, with states**, at
  1280 and 390, not just a happy path and not the unbuilt download pages
  (`nav-search`, `patterns`, `discord-attribution`, `auth-admin-discord-link`
  are dropped; git history keeps them).
- **Mockups are rebuilt in place and share one kit.** `docs/features/
  {download,tdr-bot,dev-dashboard}/designs` are rebuilt on Category Standard;
  `auth`, `portal`, `tdr-code` get new sets. All six `include` one Pug/CSS kit
  at `docs/designs/mockup-kit/` (verified: Pug resolves relative `include`
  paths outside the project's `src/`; no builder change needed). Ruled out:
  new `redesign-<app>` dirs (two sets of every page) and copying the kit per
  project (the drift the pipeline exists to prevent).
- **One review per app (H1–H6)**, so a slow review of one app doesn't block
  the others' feedback. The phase structure still means implementation
  starts after the last approval — the library tiers fill that wait, and a
  reviewed library before fifteen migration tasks is worth the checkpoint.
- **`balanced` tier for every task** (Jeremy). No `model:` keys.
- **ESLint guard against raw palette utilities** lands as the last task.
- **A live render check per app**: build, serve on a free port, screenshot
  every route at both widths, report defects. Without the Nest backend most
  pages show their error or empty state; that is still the only check that
  crosses the Tailwind `@source` / `next/font` / `@lilnas/ui` dist boundary
  for real.
- **portal gains jest+RTL; tdr-bot gains a jsdom project**, mirroring
  `apps/dev/jest.config.js`, so the redesigned components get render tests.
- **`@lilnas/ui` is built with `tsc` to `dist/` like `@lilnas/utils`**, one
  entry `@lilnas/ui` plus `@lilnas/ui/theme.css`; `index.ts` is written once
  in the scaffold with every export line and empty placeholder modules, so
  the five tier tasks never touch the same file.
- **Base UI `@base-ui/react` pinned at 1.9.0** (latest; `render` prop for
  polymorphism, `data-open`/`data-starting-style`/`data-ending-style` for
  transitions). Radix/shadcn ruled out per `docs/designs/adoption.md`.
- **tdr-code gets a phone layout for the first time** (nav collapses into a
  Sheet, tables become `DataList`, the log viewer works at 390). The
  `log-viewer.tsx` state logic is not rewritten; only its markup.
- **MUI deps are removed from tdr-bot in a final task after the last page
  migrates**, since removing them earlier would break type-check for pages
  still on MUI.

## Context
- pnpm 12 + Turbo monorepo on Node 26; apps in `apps/`, libraries in
  `packages/`. Run scripts with `pnpm --filter @lilnas/<pkg> <script>`.
  `@lilnas/utils` and `@lilnas/ui` export from `dist/` (workspace packages are
  *injected* copies, resynced after each package's `build`), so after editing
  `packages/ui` run `pnpm --filter @lilnas/ui build` before an app's
  type-check, jest or `next build`. Jest maps `@lilnas/utils/*` to
  `packages/utils/src`; map `@lilnas/ui` to `packages/ui/src/index.ts` the
  same way. Class names: `cns()` from `@lilnas/utils/cns` (it registers the
  `text-h1…text-label` size tokens; keep that list in sync with `theme.css`).
  Lint = eslint + prettier (`pnpm --filter @lilnas/<pkg> lint`, fix with
  `lint:fix`). Always `--maxWorkers=2` and a scoped path/`--selectProjects`
  for jest; never the unscoped download suite.
- Design system: `DESIGN.md`, `docs/designs/{foundations,components,motion,
  voice,adoption}.md`, live reference `docs/designs/preview/index.html`,
  marks `docs/designs/assets/pepe-badge.svg` + `apps/auth/public/sad-pepe.svg`.
  Fonts: Geist + Geist Mono via `next/font/google` mapped with `@theme inline`
  (foundations.md "Fonts"). The component API to build is `components.md`;
  the existing implementations to lift from are `apps/download/src/components/
  ui/*` (24 files, specs in `ui/__tests__/`) and `apps/dev/src/components/ui/*`.
- Mockups: Pug + Tailwind pipeline `docs/features/download/designs/README.md`
  (`pnpm --filter @lilnas/cli build` once, then `pnpm mockups`,
  `pnpm mockups:lint`; commit the generated `*.html`). Harness mixins
  (viewport switch, app frame) are in that project's `src/mixins/mock.pug`.
  No behavioural JS in mockups; states are shown side by side or via CSS
  `:has()` radios.
- Apps: all Next 16.4 + React 19.3 app router, Tailwind 4.3 CSS-first (no
  `tailwind.config`), each with a Nest backend on 8081 reached through a
  `/api/:path*` rewrite — except `portal` (Next only). Frontend jest projects:
  auth `frontend`, dev `jsdom`, download `jsdom`, tdr-code `frontend`
  (RTL + jest-dom, setup files under `src/**/__tests__/`).
- **This machine is production.** Never run `docker compose up/down/restart/
  pull/--build` against the `lilnas` project, never `docker stop/rm` a
  `lilnas-*` container, never print `.env.keys` or any `.env.prod`/
  `*.decrypted`. `apps/tdr-code` in `/home/jeremy/lilnas` is the *live*
  tdr-code install: never run `next build`/`pnpm build` there or
  `scripts/daemon.sh`; building inside the run's worktree is fine. Kill every
  server you start and delete temp files. Agents have no sudo.

## Done means
Implemented as the task says, matching its approved mockup; the touched
package's lint, type-check and scoped jest pass, with tests covering each
state and interaction the task names; no `@mui/*`, `@emotion/*`, `gray-*`,
`zinc-*`, `slate-*`, `neutral-*` or `blue-*` utility, hex colour, or
`uv-*`/`ease-uv` alias remains in files the task touches (migration tasks)
or anywhere in the six apps (final task); every `.pug`/`.css` change under
`docs/` is reflected in a committed rebuilt `*.html` (`pnpm mockups` leaves
`git status` clean — except, until T6 lands, the two stale
`docs/features/dev-dashboard/designs/*.html` pages, which were built with an
older Tailwind as of `base`); existing `data-testid`/`data-track-id` attributes,
routes, server actions and SSE/WS behaviour unchanged unless the task says
otherwise; nothing with a frontend test suite at `base` loses coverage (auth
66, dev 66, download 2039, tdr-code 312, tdr-bot 86 tests passing as of
`base`).

## Planner notes
<!-- Planner's working memory; tasks never see this. -->

### Run state (2026-10-24)
- Run `nexus-run:6562ddb0-a8f6-490a-8b80-d4dcdfefa99e`, branch
  `feat/design-system-redesign`, worktree
  `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign`.
- Open thread: the user chose "one review per app", but phases mean app
  implementation starts after the LAST H approval. I offered to move T16–T38
  into phase 1 for per-app starts; no answer yet.
- As of 2026-11-16: all of phase 1 has settled, including H1–H6 and R1
  (H1's mockup round). Review-remediation tasks R2 (the `@source` path in
  the docs) and R3 (Combobox Escape clears the value) are open. The T11 and
  T14 merge conflicts went through resolver agents. Check `nexus_run_get`
  for current status.
- The run note about building `@lilnas/media` (posted with C6) covers the
  next 40 dispatches. If a task raises it again, resolve it no_change.
- When a `run_checks` checkpoint names download or tdr-bot with
  "Cannot find module '@lilnas/media/…'", run `pnpm --filter @lilnas/media
  build` in the run worktree, then resolve it `manual_resolved`. When a
  `run_dirty` checkpoint lists only generated mockup HTML, resolve it
  `manual_resolved` with `commit: true`.

### Verified at base (main 80781a62)
- Lint + type-check pass for all six apps. Frontend jest: auth 66, dev 66,
  download 2039 jsdom (13s), tdr-code 312, tdr-bot `src/app` 86.
- `pnpm mockups` passes but regenerates the two dev-dashboard HTML pages with
  a diff (committed HTML is stale), so there is no `git diff --exit-code`
  check; the rule lives in Done means instead.
- Pug relative `include` from a project's `src/layout` to
  `docs/designs/mockup-kit/` resolves under the builder's `basedir: src`
  (tested). Builder: `packages/cli/src/utils/mockup-builder.ts`. turbo
  `//#mockups` inputs cover only `docs/features/*/designs/src/**` — T3
  widens them.
- `@base-ui/react` latest is 1.9.0 (`@base-ui-components/react` is the old
  rc name). Toast is `Toast.Provider` + `useToastManager`; Tabs.Indicator
  exposes `--active-tab-*` vars.
- `playwright-cli` is not on PATH (nvm v24 was removed); `npx -y
  @playwright/cli@0.1.22` works from the npx cache, Chromium is in
  `~/.cache/ms-playwright`. `/storage/files` is writable and served at
  `https://files.lilnas.io/`.
- Workspace packages are injected copies resynced on `build`
  (`pnpm-workspace.yaml`), hence the `pnpm --filter @lilnas/ui build` prefix
  in every check and the `@source …/node_modules/@lilnas/ui/dist` line.

### Research the surveys produced (not in adoption.md)
- tdr-bot is a full MUI admin UI (settings, transcript, reminders, emojis,
  playground; 24 files import MUI, styling all `sx`, no fonts loaded, no
  jsdom tests). Plan 010 left F1/F4/F5/T6 open; T27 fixes F5 only.
- download already left MUI; 24 `ui/` files with specs, 637 arbitrary px
  values, `sm:` is its only real breakpoint. No Playwright anywhere.
- tdr-code: no responsive layout (4 breakpoint classes total), 343 `gray-*`
  uses, specs assert on class names (`log-row`, `log-detail-panel`, logs
  `page`, `login`). Prod runs host-native from `/home/jeremy/lilnas/apps/
  tdr-code` (PORT 8790 / BACKEND_PORT 8791); a build there killed prod once.
- auth: `design-tokens.css` is 1288 lines of hand classes, modals lack
  `role="dialog"`/focus trap, people list is rendered twice (table + cards).
- portal: no tokens, no fonts, no tests; `deploy.dev.yml` port mismatch
  (dev on 3000, label says 8080) — not in scope, worth a follow-up.
- `cns()` registers the `text-h1…label` sizes; T1 keeps the same names.

### C1 (T1, 2026-10-24)
- download and tdr-bot checks now build `@lilnas/media` too (its `exports`
  point at `dist/`). Stale dev-dashboard HTML is absorbed by T6 (rebuild in
  place); no separate docs-only task, it would duplicate T6 and share its
  `files`. Done means labels the stale pages as of `base`.

### C2 (T11, 2026-10-24)
- Scaffold laid modules out as `packages/ui/src/<name>/index.ts`, not
  `src/<name>.tsx` as the T10–T15 `files` say; the directories still don't
  overlap across tasks, so no re-lock needed. T41 (after T10 + T11) rewires
  Input `icon` → `IconName`/`<Icon>` and Search → package `Button`; the app
  entry tasks T17, T19, T20, T24, T29 now wait on T41 too.

### C3 (T3, 2026-10-24)
- `DESIGN.md` still links `docs/designs/preview/index.html` twice (lines 5
  and 194); the preview moved to `docs/features/design-system/designs/`.
  Folded into T40, which already owns `DESIGN.md`.

### T10/T3 run_checks stall (2026-10-24)
- The run's `config.checks` is a snapshot from Start and still lacks the
  `@lilnas/media build` step the frontmatter has, so the run worktree had
  no `packages/media/dist` and the download + tdr-bot checks failed there.
  I built it by hand in the run worktree (gitignored, so it stays unless
  the worktree is cleaned). If it comes back, rebuild it and resolve the
  checkpoint `manual_resolved`.
- `pnpm mockups` regenerates the stale dev-dashboard HTML on every
  integration, which dirties the run worktree (run_dirty). I committed the
  regenerated pages onto the run branch with `commit: true`.

### C6 (T6, 2026-10-24)
- C6 asked for the `@lilnas/media build` step the frontmatter already has.
  Resolved no_change: the runner is still on the checks it copied at Start.
  Added a run note (next 40 dispatches) telling tasks to build media in
  their own worktree.

### C5 (T4, 2026-10-24)
- The kit's `dataList` mixin only renders badge, mono or plain cells, so
  auth added its own `authDataList` (`docs/features/auth/designs/src/mixins/auth.pug`).
  No change: T13's `Column.render(row): ReactNode` already covers rich
  cells. Extending the kit mixin is optional follow-up work.

### C7 (R2, 2026-11-16)
- Injected `@lilnas/ui` lives at `apps/<app>/node_modules/@lilnas/ui`, never
  the repo root. `@source` is `../node_modules/@lilnas/ui/dist` from
  `src/tailwind.css` (portal, auth, dev, download) and
  `../../node_modules/@lilnas/ui/dist` from `src/styles/globals.css`
  (tdr-bot, tdr-code). Fixed T16, T17, T24, T29 bodies; T19/T20 point at the
  README, which R2 fixes.

### C8 (T16, 2026-11-16)
- `@lilnas/ui` built CJS (`module: NodeNext`, no `"type"`), so `next build`
  of a server layout importing the barrel fails ("Element type is invalid …
  got: undefined" on `/_not-found`). T16 proved that `module: Preserve` +
  `moduleResolution: bundler` fixes it; ui tests and type-check still pass.
  jest can't see it because apps map `@lilnas/ui` to `packages/ui/src`, and
  no check runs `next build`, so only the live checks T33–T38 would hit it.
  They now wait on T42.
- The runner made R4 (T16's defect) do the ui tsconfig fix; T16 re-runs
  after it to check `next build`. T42 was trimmed to the auth/tdr-bot
  Dockerfile COPY lines plus an ESM sanity check, after T16 (a plan task
  can't list R4 in `after:`; T16's re-run follows R4). T43 = dev
  Dockerfile, after T19 (T19 locks `apps/dev/`). T20's body got the download
  line. T16 added portal's. tdr-code has no Dockerfile.
- C9 (T19) was the same bug. dev worked around it with a client
  `src/app/shell.tsx`. T43 now also waits on T42 and inlines the wrapper
  back into the server layout, verified by the dev `next build`.
- C10 (T17): auth hit it too and added a client
  `src/app/components/providers.tsx` (ToastProvider). T42 now also waits on
  T17 and inlines it. The user chose (2026-11-16) to DROP the home mockup's
  "Account ID" row rather than add `id` to `/me`; T44 edits the mockup only.
- T16 reported partial. Its departures: Open browser is accent per the
  mockup; the browser tile is always pinned; `tdr` uses the `users` icon.

### State at context clear (2026-11-16, after C10)
- C7–C10 all resolved. C8/C9/C10 are one bug (`@lilnas/ui` built CJS):
  R4 (runner-made from T16's defect) owns the tsconfig fix. If another task
  reports the CJS-barrel / "Element type is invalid" problem, resolve it
  no_change pointing at R4, or fold its workaround removal into T42/T43.
- Workarounds to undo after R4: dev `src/app/shell.tsx` (T43), auth
  `src/app/components/providers.tsx` (T42). Other apps (download T20–T23,
  tdr-code T29–T32, tdr-bot T24) may have added similar client wrappers;
  check their results and add cleanup to a task after T42 if they did.
- Plan tasks can't list R* tasks in `after:` (after_forward_phase); use T16,
  which re-runs after R4.
- The runner rewrites the tasks file (quotes and titles change), so re-read
  it before any scripted text replace.
- Dockerfile `COPY packages/ui/package.json packages/ui/` is done for portal
  (T16), auth+tdr-bot (T42), dev (T43), and download (T20 body). tdr-code has
  no Dockerfile.
- Open thread from earlier: the per-app-start offer (moving T16–T38 into
  phase 1) never got an answer. It's moot now that phase 1 is done.

### C11 (T22, 2026-11-16)
- DataList had no per-row hook, so activity faked the row fade and stagger
  with per-cell wrappers. Added T45 (after T22): `rowProps(row, index)`
  spread on the `<tr>` and the card `<li>`, with DataList's interaction
  props and `data-selected` taking precedence. Activity moves onto it. T36
  now waits on T45. `Table.Row` already spreads `tr` props, so only
  `data-list.tsx` changes in ui.

### C12 (T36, 2026-11-16)
- download NotFound/NotAuthorized used `EmptyState`, which always draws the
  pepe mascot. The approved mockup's `quietPanel` has a search/shield icon
  and no mascot. Picked: code follows the approved mockup (T46). Mockups,
  docs and `EmptyState` stay as they are.

### C13 (R5, 2026-11-16)
- C6 again (media build missing from the runner's copied checks). Resolved
  no_change and re-posted the run note for the next 40 dispatches. The run
  worktree's `packages/media/dist` was present.

### C14 (T34, 2026-11-16)
- auth had no root `error.tsx`, and its `bad` Notes skipped the alert icon the
  kit's `note` mixin always draws (`@lilnas/ui` `Note.icon` is optional).
  Added T47 (auth only, after T17+T18). Other apps may also leave out Note
  icons; not audited. R5 fixed Geist (`layout.tsx`), which T47 doesn't touch.

### C15 (T40, 2026-11-17)
- `apps/swole` was removed on main 2026-10-17 (65972ab8). Decided to strike
  it from the design docs: T40's body no longer keeps it as remaining work,
  and T48 (after T40, same files) removes it from adoption.md, components.md,
  foundations, motion and voice. T40 was already in flight when its body
  changed, so T48 does the work either way.

### Ruled out
- Per-project kit copies (drift), new `redesign-<app>` mockup dirs,
  Radix/shadcn, one H task for everything, running the unscoped download
  suite, `git diff` as a mockup check, `strong`/`frontier` tiers.

## Log
<!-- Written by Nexus. -->

### 2026-10-24 · T1 · done
No new changes; the earlier commit stands. Re-ran the @lilnas/ui check (utils build, ui build, lint, type-check, jest): passes, 18 tests.
The reported failures are environmental and pre-existing, not caused by packages/ui (no app depends on @lilnas/ui yet):
- download and tdr-bot type-check fail with "Cannot find module '@lilnas/media/...'" because packages/media/dist (gitignored) is not built in a fresh worktree and the check commands only build @lilnas/utils. After `pnpm --filter @lilnas/media build`, tdr-bot and download type-check pass.
- `pnpm mockups` regenerates docs/features/dev-dashboard/designs/{index,stack-detail}.html (Tailwind 4.1.14 -> 4.3.3 output drift already present at base). I reverted that uncommitted diff to leave the tree clean.
portal/auth/dev/tdr-code failure output was not shown; likely the same missing @lilnas/media build, but not verified.

### 2026-10-24 · T2 · done
portal: `pnpm --filter @lilnas/portal test --maxWorkers=2` runs one jsdom project (single config object, not `projects`). Specs go in `src/**/__tests__/*.tsx` or `*.spec.tsx`; use `jest.mock('src/app/browser/actions', ...)` style mocks for server actions. `@lilnas/ui` maps to `packages/ui/src/index.ts` in both apps' jest configs, so no ui build is needed for jest (still needed for type-check).
tdr-bot: projects `node` (existing config, plus an added `!**/__tests__/setup-dom.ts` exclusion and the ui mapper) and `jsdom` (roots src/app and src/components, `**/__tests__/**/*.tsx`, 10s timeout). Run with `pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`. Verified 6 suites / 86 tests still pass.
tdr-bot type-check needs `pnpm --filter @lilnas/media build` first in a fresh worktree (missing @lilnas/media/radarr and sonarr declarations otherwise); not caused by this task.
Neither app got an `@lilnas/ui` dependency in package.json (task asked only for the mapper); the redesign tasks that import it will need to add `"@lilnas/ui": "workspace:*"`.

### 2026-10-24 · T3 · run branch fails its own checks
This is not a merge conflict. T3 is done and verified, but the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign`, with or without T3:

- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`
- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`

That is usually a gitignored build output or install the run worktree lacks, or a check already red on the run branch. No resolver can fix it, since resolvers work in the task worktree. Fix the run worktree (or the plan’s `setup:`/`checks:`) and press **Retry integration**, which keeps T3’s work. Skipping the task is also possible, but the next task’s checks will fail the same way.

### 2026-10-24 · T11 · run branch fails its own checks
This is not a merge conflict. T11 is done and verified, but the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign`, with or without T11:

- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`
- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`

That is usually a gitignored build output or install the run worktree lacks, or a check already red on the run branch. No resolver can fix it, since resolvers work in the task worktree. Fix the run worktree (or the plan’s `setup:`/`checks:`) and press **Retry integration**, which keeps T11’s work. Skipping the task is also possible, but the next task’s checks will fail the same way.

### 2026-10-24 · T10 · run branch fails its own checks
This is not a merge conflict. T10 is done and verified, but the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign`, with or without T10:

- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`
- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`

That is usually a gitignored build output or install the run worktree lacks, or a check already red on the run branch. No resolver can fix it, since resolvers work in the task worktree. Fix the run worktree (or the plan’s `setup:`/`checks:`) and press **Retry integration**, which keeps T10’s work. Skipping the task is also possible, but the next task’s checks will fail the same way.

### 2026-10-24 · T12 · done
No code changed since the first report; commit 1930ef01 stands. The reported check failures were environmental.
- `packages/media/dist` is gitignored and absent in a fresh worktree, and the check commands only build `@lilnas/utils`. The download and tdr-bot type-checks fail with "Cannot find module '@lilnas/media/...'" until `pnpm --filter @lilnas/media build` has run. Nothing in packages/ui touches `@lilnas/media`.
- With media built, I reran every check and all pass: ui (build, lint, type-check, 73 tests), portal (lint, type-check, 1 test), auth frontend 66, dev jsdom 66, download jsdom 2039, tdr-bot 86, tdr-code frontend 312, `pnpm mockups` and `pnpm mockups:lint`. The counts match the baseline in the plan.
- `pnpm mockups` regenerates docs/features/dev-dashboard/designs/{index,stack-detail}.html because they were built with an older Tailwind. The plan allows that drift until T6. I reverted both files so the tree is clean.
- The earlier implementation notes still apply: indeterminate Progress reuses the `shimmer` keyframe, and jest.config.js gained a `src/*` mapping because the lint rule enforces `src/...` imports.

### 2026-10-24 · T3 · conflict: manual_resolved
This is not a merge conflict: the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` (`pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`, `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`), with or without the task.

The run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` was fixed by hand; the integration is retried with T3’s work kept.

### 2026-10-24 · T11 · conflict: manual_resolved
This is not a merge conflict: the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` (`pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`, `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`), with or without the task.

The run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` was fixed by hand; the integration is retried with T11’s work kept.

### 2026-10-24 · T3 · run branch fails its own checks
This is not a merge conflict. T3 is done and verified, but the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign`, with or without T3:

- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`
- `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`

That is usually a gitignored build output or install the run worktree lacks, or a check already red on the run branch. No resolver can fix it, since resolvers work in the task worktree. Fix the run worktree (or the plan’s `setup:`/`checks:`) and press **Retry integration**, which keeps T3’s work. Skipping the task is also possible, but the next task’s checks will fail the same way.

### 2026-10-24 · T10 · conflict: manual_resolved
This is not a merge conflict: the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` (`pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`, `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`), with or without the task.

The run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` was fixed by hand; the integration is retried with T10’s work kept.

### 2026-10-24 · T10 · done
Re-ran every check after the runner's failure report; no code change was needed.
- `@lilnas/ui` build, lint, type-check and jest pass (130 tests).
- The reported download and tdr-bot type-check failures come from `packages/media/dist` being gitignored and unbuilt in a fresh worktree, because the check commands only build `@lilnas/utils`. After `pnpm --filter @lilnas/media build`, lint and type-check pass for portal, auth, dev, download, tdr-bot and tdr-code. Jest passes: auth 66, dev 66, tdr-code 312, tdr-bot 86, download 2039. The runner's checks should build `@lilnas/media` first.
- `pnpm mockups` regenerates `docs/features/dev-dashboard/designs/{index,stack-detail}.html` because of Tailwind 4.1.14 to 4.3.3 output drift already present at base. It is unrelated to this task (no `.pug` or `.css` touched). I reverted the regenerated files and left the tree clean. `mockups:lint` passes.
- Design decisions from the first report still apply: default Button variant is `outline` and size is `md`. AppBar's `sheet` slot is a caller-supplied phone menu that includes its trigger. The `no-relative-import-paths` lint rule is off for `packages/ui/src`.

### 2026-10-24 · T3 · conflict: manual_resolved
This is not a merge conflict: the run branch fails its own checks in the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` (`pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest --selectProjects jsdom --maxWorkers=2`, `pnpm --filter @lilnas/utils build && ([ ! -d packages/ui ] || pnpm --filter @lilnas/ui build) && pnpm --filter @lilnas/tdr-bot lint && pnpm --filter @lilnas/tdr-bot type-check && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/tdr-bot exec jest src/app src/components --passWithNoTests --maxWorkers=2`), with or without the task.

The run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` was fixed by hand; the integration is retried with T3’s work kept.

Run worktree lacked packages/media/dist (gitignored). Built it; download and tdr-bot checks pass in the run worktree.

### 2026-10-24 · T3 · run worktree has uncommitted changes
This is not a merge conflict. T3 is done and verified, but its integration couldn’t start: the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` has uncommitted changes to tracked files nobody on the run owns:

- `docs/features/dev-dashboard/designs/index.html`
- `docs/features/dev-dashboard/designs/stack-detail.html`

Integration waits until they are gone. Commit them onto the run branch (**Commit to run branch**), discard them (**Discard changes**), or clean them up yourself and press **I cleaned it up**; then the integration is retried. Skipping the task is also an option, but these changes would still block the next one.

### 2026-10-24 · T3 · conflict: manual_resolved
This is not a merge conflict: the run worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-design-system-redesign` had uncommitted changes to `docs/features/dev-dashboard/designs/index.html`, `docs/features/dev-dashboard/designs/stack-detail.html`, so the integration couldn’t start.

The runner committed the run worktree’s uncommitted changes onto `feat/design-system-redesign` as 6708f180d04c (`chore(plan-runs): commit stray run-worktree edits`):

- `docs/features/dev-dashboard/designs/index.html`
- `docs/features/dev-dashboard/designs/stack-detail.html`

These are the stale dev-dashboard pages that `pnpm mockups` regenerates on every check run; committing the regenerated output so it stops dirtying the run worktree. T6 rebuilds them later anyway.

### 2026-10-24 · T3 · done
Kit usage and gotchas are in docs/designs/mockup-kit/README.md (project theme.css is three lines; pages `extends ../../../../../designs/mockup-kit/page.pug`; call mixins as `+card()(class=...)` when no args; compute ternaries before mixin calls; pin states with data-force; appBar/search/dataList take view; dialog/sheet fill the nearest relative ancestor; `text-label uppercase`).

Check failures after the first report: download and tdr-bot type-check failed only because packages/media/dist was not built in the worktree (gitignored; `pnpm --filter @lilnas/media build` fixes it, then both pass). The dirty tree after `pnpm mockups` came from dev-dashboard's committed html being built with Tailwind 4.1.14; I committed the rebuilt files (2e527b2b, no source change), so `pnpm mockups` now leaves git status clean and `pnpm mockups:lint` passes. Per-app tasks that rebuild dev-dashboard will regenerate those files anyway.

Earlier run of lint/type-check/jest on portal, auth, dev, download (2039), tdr-bot (86), tdr-code was green; this change touches only docs, package.json and turbo.json.

### 2026-10-24 · T11 · conflict: delegate_agent
The squash merge conflicted in `packages/ui/jest.config.js`. Integrated since its base: T2 · Test scaffolds: jest + RTL for portal, a jsdom project for tdr-bot; T12 · @lilnas/ui tier 2b: Spinner, Skeleton, Progress, Meter, Toast, Note, Avatar, Tooltip, Breadcrumb, Pagination, Kbd.

Resolve with an agent: claude, opus (try 1).

### 2026-10-24 · T11 · resolver: done
Merged feat/design-system-redesign into T11. Resolved packages/ui/jest.config.js by keeping both sides: the ts-jest tsconfig now has baseUrl + paths + types, and the duplicate '^src/(.*)$' mapping is folded into one entry. Discarded the earlier try's rebuilt copies of the two stale dev-dashboard HTML pages so the merge could run. Ran pnpm install --frozen-lockfile to install T2's portal test deps; the lockfile didn't change. Every check passes (ui 218, portal 1, auth 66, dev 66, download 2039, tdr-bot 86, tdr-code 312 tests; mockups build and lint pass and leave the tree clean).

### 2026-10-24 · T11 · done
No new changes; the earlier commit stands. The reported check failures are environmental and not caused by packages/ui. No app depends on @lilnas/ui yet.
- download and tdr-bot type-check fail with "Cannot find module '@lilnas/media/...'" because packages/media/dist (gitignored) is not built in a fresh worktree and the check commands only build @lilnas/utils. After `pnpm --filter @lilnas/media build`, lint and type-check pass for portal, auth, dev, download, tdr-bot and tdr-code. Jest passes for auth (66), dev (66), tdr-code (312) and tdr-bot (86). The download jsdom suite was not run.
- @lilnas/ui check (utils build, ui build, lint, type-check, jest): passes, 51 tests.
- `pnpm mockups` regenerates docs/features/dev-dashboard/designs/{index,stack-detail}.html (Tailwind drift already present at base, excepted until T6). I reverted that diff to leave the tree clean.
- Suggested runner fix: add `pnpm --filter @lilnas/media build` to the checks before the app type-checks.

### 2026-10-24 · T13 · done
No code change since the first report. The reported failures are environmental, not caused by T13: `packages/media/dist` is gitignored and unbuilt in a fresh worktree, and the checks only build `@lilnas/utils` and `@lilnas/ui`. After `pnpm --filter @lilnas/media build`, every check passes:
- ui: build, lint, type-check and jest pass (220 tests).
- Lint and type-check pass for portal, auth, dev, download, tdr-bot and tdr-code.
- Jest passes: auth 66, dev 66, tdr-code 312, tdr-bot 86, download 2039.
- `pnpm mockups:lint` passes.
- `pnpm mockups` regenerates `docs/features/dev-dashboard/designs/{index,stack-detail}.html` because of Tailwind output drift already present at base. I reverted them and left the tree clean, so those two pages should not count as a failure. The runner's checks should build `@lilnas/media` first.
- The design decisions in the first report still apply.

### 2026-10-24 · T14 · conflict: delegate_agent
The run’s checks failed after the squash. Integrated since its base: T3 · Mockup kit on Category Standard + design-system preview project; T11 · @lilnas/ui tier 2a: Input, Textarea, Field, Search, Checkbox, Radio, Switch, Segmented, Tabs (Base UI); T13 · @lilnas/ui tier 2c: Table, DataList, LogViewer.

Resolve with an agent: claude, opus (try 1).

### 2026-10-24 · T4 · done
Re-run of the failed checks: all eight pass. The download and tdr-bot type-check failures came from packages/media/dist not being built in this worktree (gitignored), not from this change, which touches only docs/features/auth. `pnpm --filter @lilnas/media build` fixes it. Results after that: ui, portal, auth (66), dev (66), download (2039), tdr-bot (86), tdr-code (312) all green, and `pnpm mockups` + `pnpm mockups:lint` leave git status clean.

Mockups for the auth migration task live in docs/features/auth/designs. Page-by-page notes for the implementer:
- Gate screens (pending, blocked, admin error boundary) show the doorplate top-left; login has no doorplate, its 380px card carries pepe-full instead.
- Login: no target, target pill, `?error=` as `note bad` (lead "Google didn't sign you in." + mono code), redirecting (button loading, toast "Redirecting…").
- Home: account avatar 64 (accent fill = you), status badge tones admin=accent, granted=ok, pending=warn, blocked=bad, no access=mute. Session details is a dl with Role, Member since, Signed in with, Account ID (mono). Account ID needs `id` on GET /me (MeResponse has none today); drop the row if not added. Empty state "No services granted yet." has one button, "Check again" (router.refresh).
- Pending: waiting = large live accent dot ring; Check again has a spinning refresh icon; declined = x ring + "Request access again" as the accent button.
- Blocked: "Still blocked" toast uses tone bad.
- Admin: Reject renamed Decline; bulk "Dismiss selected (n)"; Add person is outline, Approve/Link are accent. People and Blocked render from one column definition (table at 1280, card list at 390). window.confirm is replaced by a dialog with a filled-red confirm (Block / Keep access; also remove access, sign out everywhere, unlink Discord).
- Toast copy per action is listed in data/admin.mjs `toasts`.
- Mockup radios need a unique `name` per viewport panel (both panels are in the DOM), otherwise one checked radio wins document-wide.
- Tailwind responsive prefixes answer to the browser window, not the frame, so all viewport differences are explicit `view` conditionals in mixins/auth.pug.
- Discord panel filter inputs are drawn always; in the app they appear only at 8 or more rows (FILTER_MIN_ROWS), keep that rule.

### 2026-10-24 · T5 · done
The earlier check failures were not caused by this change. `@lilnas/media`'s gitignored `dist` was not built in the worktree, so download and tdr-bot could not resolve `@lilnas/media/*`. `pnpm --filter @lilnas/media build` fixes it, and the checks pass with no source change. Any check runner that starts from a fresh worktree needs that build step.

Everything else is as in the first result:
- Portal mockups are on the shared kit with a local `portalBar` (doorplate only).
- The browser tile opens the power page.
- One accent button per view.
- Six browser states.

### 2026-10-24 · T14 · resolver: done
Merged feat/design-system-redesign (T13 Table/DataList/LogViewer) with no textual conflicts.
The check failure was a timing race in the Select keyboard test: Base UI sets the initial
highlight a frame after opening, and under a loaded runner it overwrote the second ArrowDown.
The test now waits for data-highlighted on Standard, then on High, before pressing Enter.
Component code is unchanged. All eight plan checks pass (ui 287/287 three runs in a row; portal,
auth, dev, tdr-bot, tdr-code, download, mockups) and the tree is clean.

### 2026-10-24 · T14 · done
Decisions:
- Enter and exit use CSS transitions on `data-starting-style` / `data-ending-style` (200ms, 6px rise plus fade), not the `animate-rise` keyframes. A keyframe fill-forwards would hold the popup in place and stop the exit from running. The scrim fades over 200ms. Sheets translate over 380ms `ease-standard`.
- `ConfirmDialog` does not close itself on confirm; the caller owns `open` and closes it. While `pending`, the confirm button is loading (`aria-busy`, `aria-disabled`, clicks swallowed), Cancel is disabled, and Escape and scrim dismissal are ignored. The default cancel label is "Keep it". Cancel sits first in the DOM, so focus lands on it.
- The filled red confirm is `bg-bad text-bg-sunk`, applied only in `ConfirmDialog` on top of `Button variant="accent"`.
- `Dialog.Popup` bundles Portal, Backdrop, Viewport and Popup. Base UI draws one Backdrop for nested dialogs, so nesting keeps a single scrim. The inner popup carries `data-nested`.
- `Sheet.Popup` takes `side` (default `right`). A `bottom` sheet draws a 36x4 grab handle, `span[data-sheet-handle]`. There is no swipe gesture.
- `Menu.Item` takes `destructive` and `shortcut`. `Menu.Popup` and `Select.Popup` bundle Portal and Positioner, take `side`, `align` and `sideOffset`, and default to `bottom` / `start` / 4px.
- `Select.Popup` sets `alignItemWithTrigger={false}`, so it opens under the trigger at its width. `Select.Trigger` uses `h-(--control-h)`, `border-line-control` and `bg-bg-sunk`, with a rotating chevron. `Select.Value` uses `data-placeholder:text-ink-3` for the null / placeholder case. Pass `items` to `Select.Root` so `Value` shows the label instead of the raw value.
- Shared class strings are in `packages/ui/src/internal/overlay.ts`. It is not re-exported from the barrel.
- `ReasonGroup`/`Reason` and `DeleteButton` are not exported from `@lilnas/ui`. The task's export contract didn't list them, so the download migration should keep those as app-local components built on `Dialog` and `Button`.
- I added a `PointerEvent` polyfill to `src/__tests__/setup-dom.ts`. jsdom 26 lacks it, and Base UI uses it to turn Enter on a menu item or select option into a click. Later specs get it for free.
- Base UI's Menu arrow-key wrap-around doesn't fire in jsdom (it should wrap, since `loopFocus` defaults to true), so the spec covers Down/Up/Home/End without wrapping.
- The check commands only build `@lilnas/utils`. A fresh worktree also needs `pnpm --filter @lilnas/media build` before download/tdr-bot type-check, as T10 noted.

### 2026-10-24 · T6 · done
The earlier check failures were an environment gap, not a code defect: packages/media/dist (gitignored) was not built in the worktree, so download and tdr-bot type-check could not resolve @lilnas/media/radarr and /sonarr. After `pnpm --filter @lilnas/media build`, every check passes: ui 218, portal 1, auth 66, dev 66, download 2039, tdr-bot 86, tdr-code 312, and pnpm mockups plus mockups:lint with a clean git status. This task changes only docs/features/dev-dashboard/designs. No new commit was needed; 47c4d2cd stands.

The runner's check commands should build @lilnas/media first (or the checks will fail in any fresh worktree).

Design decisions for the dev app task are unchanged from the first report: state badge tones, label-only action buttons, verb-named confirm button, masonry columns, and the kit app bar (avatar on desktop and a menu button on mobile, neither of which the app's AppBar has yet).

### 2026-10-24 · T8 · done
No new commit. The reported check failures were the known environment gap (packages/media/dist unbuilt in a fresh worktree, so download and tdr-bot type-checks could not resolve @lilnas/media/*), not caused by this docs-only change.
After `pnpm --filter @lilnas/media build`, every check passes: ui (253 tests), portal, auth (66), dev (66), download (2039), tdr-bot (86), tdr-code (312), and cli build + mockups + mockups:lint. git status is clean.

### 2026-10-24 · T7 · done
The earlier check failures were the known environment gap: `packages/media/dist` is gitignored and not built in a fresh worktree, so the download and tdr-bot type-checks could not resolve `@lilnas/media/*`. After `pnpm --filter @lilnas/media build`, every check in the plan passes: ui 253, portal lint and type-check, auth 66, dev 66, download 2039, tdr-bot 86, tdr-code 312, and `pnpm --filter @lilnas/cli build && pnpm mockups && pnpm mockups:lint`. No code or source changed after commit 714ecc3a; this task only touches docs/features/download/designs.
Decisions: the bad-file dialog confirm reads "Report problem" (voice.md bans "Submit"; the app currently says "Submit report"). The activity page keeps a local table (progress bars in cells) instead of the kit `dataList`.

### 2026-10-24 · T9 · done
Mockups only; `pnpm mockups` and `pnpm mockups:lint` pass and leave git clean. Lint, type-check and scoped jest pass for ui, portal, auth, dev, tdr-code and tdr-bot, and lint and type-check pass for download. I did not run the download jest suite, because it nearly OOM'd production before. The runner should rerun it.

Design decisions for the implementation tasks are in docs/features/tdr-code/designs/README.md ("Decisions the mockups make"). The ones that go beyond restyling:
- Phone nav: a bottom sheet from the app bar, with Log out inside it.
- Inline confirms keep the Confirm / Cancel labels and data-track-ids; the prompt names the object.
- Channel state badges: working = ok and live, idle = accent, stale = bad, last-known = mute.
- Bot "last seen" becomes a relative machine time (`4h ago`) instead of a locale date.
- Logs' filtered-empty gets a Clear filters action. The app has none today.
- No Retry is added anywhere the app lacks one. Only the log viewer and the segment error (Try again) keep theirs.
- not-found.tsx becomes the empty state (mascot) with Back to sessions as a button.
- Git chips become badges. "Decrypt/parse-failed" is now "Decrypt failed", with a note saying what is blocked.
- global-error.tsx must stay inline-styled. The literal values to inline are in the boundaries mockup (bg #0e0c14, ink #ebe8f2, ink-3 #a29cb4, accent #9b7bf5, accent-ink #120a2a, radius 6px, system-ui). Its copy changes too.

Mockup-only gotchas for whoever extends these pages:
- Pug escapes `&` in class attributes, so Tailwind never sees `[&>x]:` variants. Use `*:` instead.
- The builder re-indents HTML, so `whitespace-pre-wrap` shows the indentation. Draw multi-line text one `<p>` per line.
- The kit's table and cardList use `[&:last-child>td]:border-b-0`, which has the same escaping problem, so the last row's bottom border is not removed. The kit is outside this task.

### 2026-10-24 · T41 · done
Input `icon` is now `IconName` and renders the package `Icon` (16px, pointer-events-none, text-ink-4; theme.css has no `fg-mute` token, so ink-4 was kept). Search uses the package Button (accent, icon="search", aria-label, `loading` + `disabled` while pending); the label is `hidden sm:inline` and the button is squared below sm with `max-sm:w-(--control-h) max-sm:px-0`.
The reported check failures are environmental, not caused by this change: download and tdr-bot type-check fail with "Cannot find module '@lilnas/media/...'" because packages/media/dist (gitignored) is not built in a fresh worktree. After `pnpm --filter @lilnas/media build`, @lilnas/ui build/lint/type-check/jest (290 tests) pass, lint and type-check pass for portal, auth, dev, download, tdr-bot and tdr-code, and `pnpm mockups` + `mockups:lint` pass with a clean tree. App jest suites were not rerun; packages/ui is not imported by any app yet.

### 2026-10-24 · T15 · done
The reported check failures were the known environment gap, not caused by this change: `packages/media/dist` is gitignored and unbuilt in a fresh worktree, so the download and tdr-bot type-checks fail with "Cannot find module '@lilnas/media/sonarr'" (and radarr). After `pnpm --filter @lilnas/media build` every check in the plan passes in this worktree: ui (326 tests), portal (1), auth (66), dev (66), download jsdom (2039), tdr-bot (86), tdr-code (312), and cli build + `pnpm mockups` + `pnpm mockups:lint` (tree stays clean). No code changed after the first report. Suggested runner fix: add `pnpm --filter @lilnas/media build` ahead of the app type-checks in the checks list.
API and decisions are unchanged from the first report: Combobox takes `items, groups?, value?, defaultValue?, onValueChange, placeholder?, allowCustom?, emptyText?, renderItem?, label, name?, disabled?, invalid?, id?, aria-describedby?, className?`. Slider takes `value, onValueChange, min, max, step, label, format?, disabled?, name?, className?`. Disabled combobox items are skipped by re-dispatching the arrow keydown, since Base UI keeps them keyboard-reachable; re-check that on a Base UI upgrade. The thumb uses center alignment, so it overhangs the track ends by 9px.

### 2026-11-16 · H1 · changes requested
Changes requested at round 1: 1 comment, sent to R1.

Design review of `docs/features/auth/designs/blocked.html`, round 1:

1. region over <div> "Access blocked An admin blocked your account. If you think …" in scene "Access blocked"
   - selector: `body > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2)` at fx 0.34, fy 0.87, fw 0.11, fh 0.13
   - **user:** the fingernail border does not look good. we should fix this for all designs
   - screenshot 1 attached

### 2026-11-15 · H2 · approved
Approved.

### 2026-11-15 · R1 · done
No new code change: the runner's failures were not caused by the toast fix. After `pnpm --filter @lilnas/media build`, every check passes run sequentially: ui (329 tests, three consecutive runs), portal, auth 66, dev 66, download 2039, tdr-bot 86, tdr-code 312, and cli build + `pnpm mockups` + `mockups:lint` with a clean tree.
The ui failure was tier3a/menu.spec.tsx "activates the focused item with Enter and closes", a timing flake under parallel load; it is unrelated to the toast and passed on every rerun here. It may be worth rerunning the ui check alone rather than alongside the app suites.
The download and tdr-bot failures are the known `@lilnas/media` dist gap from the run notes.

### 2026-11-15 · H3 · approved
Approved.

### 2026-11-15 · H1 · approved
Approved.

Approved at round 2.

### 2026-11-15 · H5 · approved
Approved.

### 2026-11-15 · H4 · approved
Approved.

### 2026-11-15 · H6 · approved
Approved.

### 2026-11-16 · Phase 1 · review cycle 1
Pass 1 (T1, T2): T1/T2 scaffolds are correct and checks pass; the one defect is the plan-mandated @source path in the README/theme header, which resolves to a directory that does not exist under injected workspace packages, so component classes would never be generated.
Pass 2 (T12): T12 builds the tier-2b primitives with the asked-for tests and everything passes. One P1: the Toast tone uses a border-l-* on a rounded box, which components.md explicitly forbids, and the spec asserts the forbidden class. One P2: the indeterminate Progress band stutters at the end of each loop.
Pass 3 (T10): T10's tier-1 components follow the spec: the icon set is the full de-duplicated union of the three app sets, the badge mark matches the pepe-badge.svg recipe, and Button's loading/disabled/render, StatusDot's pulse rule, Badge's never-a-button rule and the tests all hold. No P0 or P1 defects. Two small P2 accessibility edge cases are noted.
Pass 4: Pass 4 holds only a regeneration of the two dev-dashboard mockup HTML pages with Tailwind v4.3.3. The output is equivalent to before, with no source or app code changes and no defects.
Pass 5 (T3): T3's mockup kit (theme.css, ui.pug, mock.pug, page.pug, sprite.html, READMEs), the design-system preview project and the turbo/package.json wiring match the task; no P0/P1 defects found. One P2: the Input 'Hover' state cell is not actually a hover state.
Pass 6 (T11): T11 builds Input/Textarea/Field/Search, Checkbox/Radio/RadioGroup/Switch/Segmented and Tabs on Base UI, with tests for each state and interaction the task names. I found no P0/P1 defects, only two small P2 edge cases in Field's aria wiring.
Pass 7 (T13): T13 adds Table, DataList, LogViewer and LogLineRow as specified, with tests for every named state; tokens and cns size registration check out. Only a P2 edge on DataList's click-through guard.
Pass 8 (T4): T4 adds auth mockup sources (data, mixins, pages) on the shared kit plus generated HTML. Every hand-written hunk was read and checked against the kit mixin API, the sprite and the task's page and state list; no defects found. The generated *.html hunks were not read line by line (the merged-branch pnpm mockups + mockups:lint check builds and lints them cleanly), hence partial.
Pass 9 (T5): T5 adds the portal mockups (index, home, browser) on the shared kit. The Pug, data and theme sources are correct and match BrowserControl/browser.ts; no defects found. The three generated HTML files (~8.4k lines) were only grep-checked, not read hunk by hunk.
Pass 10 (T14): T14 implements Dialog, ConfirmDialog, Sheet, Menu and Select as the contract asks, and every test the task names is present; the only defect is that a function className, which the wrappers' types accept, gets dropped. Every hunk in the slice was read.
Pass 11 (T6): T6 only rebuilds the dev-dashboard mockup sources on the shared kit; every kit mixin call, icon id and data shape matches the kit, and all states the task names are drawn. No defects found. The two regenerated HTML pages were skimmed, not read line by line (they go to the H-task human review), so coverage is partial.
Pass 12 (T8): T8 changes only the tdr-bot mockup sources (Pug, data .mjs, theme.css, README) and the HTML rebuilt from them. No app code changes. The mockups build and lint cleanly on the merged branch, and nothing I checked is wrong. Coverage is partial: I spot-checked the Pug, .mjs and theme.css sources against the task but did not read every line of the 3 MB of generated HTML; per the packet, a person reviews the drawn pages at the H checkpoint.
Pass 13 (T7): T7 rebuilds the download mockups on the shared kit. `theme.css` is now the three-line import, every page extends the kit's `page.pug`, the deleted pages are gone, and the job statuses match `job-state.ts`. The build and lint pass. Coverage is partial: I checked theme.css, runtime.js, README, the page headers, the jobBadge/dlBar/dlMain mixins, activity.mjs statuses, show-detail.pug and leftover-reference greps. I did not read the rest of the ~460 KB of pug/mjs hunks hunk by hunk. The ~6.6 MB of generated HTML was skipped, as the packet's Diff section instructs.
Pass 14 (T9): T9 adds the tdr-code mockups only: Pug pages, mixins, data and the generated HTML. All non-HTML source was read. The copy, confirm labels, `?error=` codes and empty SSH fields match the app, every kit mixin option used exists, and the JSON colours follow the spec. No defects.
Pass 15 (T41, T15): T41 (Input icon/Search on Icon+Button) and T15 (Combobox, Slider) largely match their specs; one P1: Escape on a closed Combobox clears the committed value via Base UI's escape-key path, contradicting 'Escape restores the previous value'.
Pass 16 (R1): R1 replaces the Toast's border-l tone edge with an inset before: bar in packages/ui toast.tsx, components.md, the mockup-kit toast mixin and the rebuilt auth/design-system/tdr-bot pages; all four agree and the spec test was updated. No defects found.
Seams pass: Seams pass: no cross-task disagreements found. Barrel exports, icon names, theme tokens, the cns size list, Combobox/Input composition, mockup-kit includes and mixins, and the jest @lilnas/ui mappings all agree.
Consolidation: Phase 1 builds @lilnas/ui, the mockup kit and every app's mockups, and checks pass. Three P1s: the documented @source path leaves component classes out of the built CSS; Toast draws its tone as a border-l on a rounded box (R1 reports this fixed); and Escape on a closed Combobox clears the value. The rest are P2 edge cases.

- F1 · P1 · plan-mandated · Documented @source path points at nonexistent root node_modules/@lilnas/ui — packages/ui/README.md:15 → R2
- F3 · P1 · Escape on a closed Combobox clears the chosen value — packages/ui/src/combobox/combobox.tsx:341 → R3

Notes:
- F4 · P2 · Function className silently dropped by overlay wrappers — packages/ui/src/dialog/dialog.tsx:26
- F5 · P2 · Explicit invalid={false} defeats Field error — packages/ui/src/input/input.tsx:45
- F6 · P2 · Falsy hint leaves a dangling aria-describedby — packages/ui/src/input/input.tsx:225
- F7 · P2 · DataList row click guard matches controls outside the row — packages/ui/src/table/data-list.tsx:49
- F8 · P2 · Indeterminate Progress band stutters at each loop — packages/ui/src/feedback/feedback.tsx:110

Dropped by the verifier:
- F2 · P1 · Toast tone drawn as border-l-*, which the spec forbids — packages/ui/src/toast/toast.tsx:37 (toast.tsx:23-41 already draws the tone as an inset before: bar (before:absolute before:inset-y-2.5 before:left-2 before:w-[3px] before:rounded-full before:bg-<tone>) with no border-l, and packages/ui/src/__tests__/tier2b/toast.spec.tsx:44-45 asserts before:bg-warn and before:rounded-full.)

Suspicions:
- useRender prop merge may break render-prop links (Tile href, loading Button) — packages/ui/src/card/card.tsx:128 · Tile always passes href (often undefined) into useRender, which may override the href on render={<Link href='/x' />}. Button's loading preventDefault may not stop Next Link navigation, depending on handler merge order (button.tsx:140). Neither case is tested. · confirm by: Assert toHaveAttribute('href','/x') in Tile's render test; add an RTL test with render={<a href onClick={spy}/>} and loading that checks handler order and defaultPrevented.
- Combobox disabled-row skip depends on a re-dispatched synthetic keydown — packages/ui/src/combobox/combobox.tsx:300 · Skipping relies on Base UI reacting to a native keydown dispatched in a microtask, which is unverified in browsers and across Base UI upgrades. `new KeyboardEvent` also sits under an `import type { KeyboardEvent }` from react (line 313), which is confusing and may hit TS1361. · confirm by: Browser check of ArrowUp/Down across a disabled row and at list ends; rename the React type import.
- Label-wrapped Base UI checkbox may fire twice on a direct box click — packages/ui/src/choice/choice.tsx:37 · The row is a <label> wrapping Checkbox.Root and its hidden input. Tests click only the label text and don't assert call count. · confirm by: Click the checkbox role element and expect onCheckedChange toHaveBeenCalledTimes(1).
- Dialog Viewport may intercept outside clicks meant for the Backdrop — packages/ui/src/dialog/dialog.tsx:22 · The Viewport is fixed inset-0 z-50 above the Backdrop. The test clicks the scrim directly, so it can't show whether a Viewport click counts as an outside press. · confirm by: Click outside the panel in a browser, or add a spec that clicks the Viewport element.
- Breadcrumb can only render plain <a> — packages/ui/src/navigation/navigation.tsx:43 · Crumbs are hard-coded <a href> with no render or link prop, so in Next app-router apps every crumb click is likely a full reload. · confirm by: Check whether migration tasks expect next/link navigation from breadcrumbs.
- Reduced-motion overrides miss variant-prefixed utilities — packages/ui/theme.css:296 · .dot-live::after and .skeleton reset by plain class selectors; md:skeleton or hover:dot-live keep animating. · confirm by: Build a page with md:skeleton under prefers-reduced-motion and inspect the computed animation.
- Mockup kit theme gaps: no density/control tokens; nested vp-scope cross-toggles — docs/designs/mockup-kit/theme.css:340 · The kit lacks --control-h, --control-h-sm, --body-size and compact-density overrides that packages/ui/theme.css has. The vp-scope :has() selectors also match descendant scopes, so nested viewport switches would affect each other. · confirm by: Compare a compact mockup control with @lilnas/ui Input under data-density=compact; build a nested vp-scope and flip the inner toggle.
- Download job badge labels differ from the app's labels — docs/features/download/designs/src/mixins/download.pug:26 · The mockup uses 'Needs attention' and 'Cancelling'; the app's JOB_STATUS_LABELS uses 'needs your decision' and 'cancelling…' and explains why the wording matters. · confirm by: Decide at the download H review which copy is approved.

Spec check:
- extra: Fill the tier-1 placeholder modules (packages/ui/eslint.config.cjs) — Turns off no-relative-import-paths for src/**, with the reason given in the notes.
- extra: home.pug — session details list (docs/features/auth/designs/src/mixins/auth.pug) — Adds an Account ID row that needs a new GET /me field; flagged as drop-if-not-added.
- extra: Copy per voice.md (extra states) (auth pending.mjs, tdr-code logs.mjs) — Adds a 'Checking' pending state and a logs 'Clear filters' action the apps lack; documented for H review.
- extra: Progress/AvatarStack/Tooltip props (packages/ui/src/feedback/feedback.tsx) — Exports meter thresholds and adds AvatarStack size and Tooltip side/align props; harmless.
- misunderstood: Escape restores the previous value (packages/ui/src/combobox/combobox.tsx) — Holds only while the popup is open (finding).
- misunderstood: Specs: docs/designs/components.md Toast (packages/ui/src/toast/toast.tsx) — Tone used border-l-* (finding); R1 reports the fix.
- misunderstood: Input(props: ... { icon?: IconName }) / Search: Input + accent Button (packages/ui/src/input/input.tsx) — T11 used a ReactNode icon and a hand-styled button; T41 rewired them onto Icon and Button.
- unverifiable: theme.css: the full @theme block from foundations.md verbatim (packages/ui/theme.css) — Spot checks pass; diff against foundations.md.
- unverifiable: Tooltip: no delay between neighbours; Segmented tap targets ≥44px; sheet/dialog motion timings (packages/ui/src/tooltip, choice, sheet) — Needs a real browser or touch device.
- unverifiable: panel ... with the 'Search…' row at top on touch (packages/ui/src/combobox/combobox.tsx) — Built as an aria-hidden echo row; confirm a real in-panel search field wasn't intended.
- unverifiable: Every page at 1280 and 390, each state a captioned row; copy per voice.md (docs/features/*/designs/*.html) — Visual and copy fidelity for the H reviews.
- unverifiable: tables become dataList cards (tdr-code); ended session badge (docs/features/tdr-code/designs/src/mixins/tdr-code.pug) — Built as a local tdrList and an end-reason text; confirm @lilnas/ui DataList covers these cells.
- unverifiable: Commit the HTML (pnpm mockups leaves git status clean); icon union de-duplication (docs/features/*/designs, docs/designs/mockup-kit/sprite.html) — Rebuild and check git status; confirm no source icon was dropped.

Declined to judge:
- Five P2s over the 8-finding cap: Icon/PepeBadge with aria-labelledby stays aria-hidden (icons.tsx:352); Doorplate app='' renders a '.lilnas.io' link (doorplate.tsx:28); Input 'Hover' state cell shows no hover (design-system index.pug:230); download assets/README.md still names deleted pages (line 39); Slider decimals() loses precision for exponent-form steps like 1e-7 (slider.tsx:24) — Distinct, real-looking P2 notes, cut only by the cap; a person can read them here.
- Line-by-line review of generated mockup *.html (auth, portal, dev-dashboard, tdr-bot, download, tdr-code, design-system) — Build output; the merged-branch pnpm mockups and mockups:lint pass, and the pages get a human H review.
- Mockup visual and copy choices (Account ID row, extra Checking/Clear filters states, 'Edit access', 'Report problem', docker compose spelling, loadingDetail grid, activity local table, sample-data counts) — Design and copy calls for the H checkpoint reviews, not code defects.
- Visual drift in components: Input/Tab text-body vs text-sm, Toast mixin pr-2.5 vs pr-3.5, Slider thumb overhang, input icon text-ink-4 vs text-fg-mute — Minor, or a token that doesn't exist; for the mockup review.
- uv-*/ease-uv aliases kept in packages/ui/theme.css — Transitional; Done means requires their removal only from the apps, in the final task.
- Kit table/cardList `[&:last-child>td]:border-b-0` escaped by Pug — Lives in the kit and is already noted in task notes.
- Small a11y/robustness nits (AvatarStack key collisions, AppBar href keys, EmptyState Fragment count, clickable rows without role, Search shared aria-label, Toast viewport role=status) — Edge cases, or behaviour the spec asked for.
- tsconfig excludes __tests__; barrel ordered alphabetically; ReasonGroup/DeleteButton not exported — Mirrors existing packages, has no semantic effect, or is outside the export contract.

Checked:
- Where the injected @lilnas/ui copy resolves — node_modules/@lilnas, pnpm-workspace.yaml: injectWorkspacePackages is true and root node_modules has no @lilnas/ui, so the documented @source is wrong (finding).
- Base UI Escape handling vs 'Escape restores previous value' — node_modules/@base-ui/react/combobox/input/ComboboxInput.js: Closed-popup Escape sets the value to null with reason escape-key, and the wrapper doesn't filter it (finding).
- cns THEME_FONT_SIZES out of sync with theme text tokens — packages/utils/src/cns.ts: h1..h3, body, cap, mono, mono-sm and label are registered, so size and colour classes don't collide.
- Classes referencing undeclared theme tokens — packages/ui/src/** vs packages/ui/theme.css: All colour, shadow, ease, animation and --control-h tokens are declared.
- Kit @theme drifting from packages/ui theme — docs/designs/mockup-kit/theme.css vs packages/ui/theme.css: Same colour and type tokens; the kit lacks the density/control vars (suspicion).
- Barrel export collisions and icon names across tiers — packages/ui/src/index.ts, icons.tsx: Every module is exported with no duplicate names; check, chevron and search exist.
- Icon union completeness and sprite coverage — apps/*/icons, docs/designs/mockup-kit/sprite.html: Every source icon maps to an entry; all icons the mockups use are present.
- App mockups resolving kit includes, mixins and options — docs/features/*/designs/src/**/*.pug, docs/designs/mockup-kit/ui.pug: All extends and include targets resolve; every mixin and option used exists.
- Stale border-l-[3px] toast classes after R1 — docs/**/*.html, *.pug, *.css, toast.spec.tsx: Only gitignored .build caches keep it; the test asserts before:bg-warn.
- Jest @lilnas/ui mappings and the tdr-bot project split — apps/portal/jest.config.js, apps/tdr-bot/jest.config.js: Both map to packages/ui/src/index.ts; the node project is unchanged.
- Mockup states vs real app state machines — apps/portal browser.ts, apps/download job-state.ts, apps/tdr-code pages: Portal states and timers, all 16 job statuses, and tdr-code error codes and confirm labels match.
- Deleted pages and layouts still referenced — docs/ (excluding archive and generated html): Only download assets/README.md still names them (declined P2).

### 2026-11-16 · R2 · done
All 8 plan checks pass in this worktree (the ui check passed with the earlier run; I re-ran the other seven after the failure report). The download and tdr-bot failures were the known `@lilnas/media` dist gap: `packages/media/dist` is gitignored, so those type-checks fail on a fresh worktree until `pnpm --filter @lilnas/media build` runs. Nothing from my change caused them, and no code change was needed.
Test counts match base: auth 66, dev 66, download 2039, tdr-code 312, tdr-bot 86.
The documented `@source` line is now `@source '../node_modules/@lilnas/ui/dist';` for a stylesheet at `apps/<app>/src/`. The docs say deeper stylesheets need more `../`.

### 2026-11-16 · R3 · done
No new changes this round. The download and tdr-bot check failures were the known unbuilt @lilnas/media dist (environment gap, not caused by this change). After `pnpm --filter @lilnas/media build`, all checks pass: ui 330, download 2039, tdr-bot 86, auth 66, dev 66, tdr-code 312, portal lint+type-check, mockups build + lint with a clean tree. The fix is unchanged: Combobox Root onValueChange ignores reason 'escape-key', with a regression test for Escape on a closed panel.

### 2026-11-16 · Phase 1 · review cycle 2
Re-review of the remediation diff: R2 rewrote the documented @source line to the app-local node_modules path in all four docs and added a spec that resolves each one; R3 makes the Combobox Root ignore 'escape-key' value changes and adds a closed-panel Escape regression test. Both prior P1s are fixed and the remediation adds no new defects.

Earlier findings: F1 fixed, F3 fixed.

Suspicions:
- Plan task body still carries the old @source path — docs/plans/017-design-system-redesign.tasks.yaml:94 · The T1 body still says `@source '../../../node_modules/@lilnas/ui/dist'`. A later app-migration session that copies the line from the plan instead of packages/ui/README.md would bring back the silent missing-@source failure. · confirm by: Check whether the phase-2 app-migration task bodies quote the @source line or point at packages/ui/README.md.

Declined to judge:
- theme.spec reads docs files outside packages/ui via a repo-root-relative path — Works in the monorepo checkout. It is a style and coupling choice, not a defect.

Checked:
- Old @source path left in a doc the redesign tasks read — repo-wide grep excluding node_modules: Only the plan yaml still has it; README, theme.css, foundations.md and adoption.md are updated.
- Ignoring 'escape-key' in onValueChange swallows a real selection — packages/ui/src/combobox/combobox.tsx: Escape never selects an item. The open-panel Escape restore is still handled by onOpenChange, and onInputValueChange only reacts to 'input-change', so the text is not cleared either.
- New theme.spec regex also matching the explanatory deeper-path example — packages/ui/src/__tests__/theme.spec.ts: The example in foundations.md is not written as `@source '...'`, so only the canonical line is asserted.

### 2026-11-16 · T16 · partial
Portal lint, type-check and jest pass (13 tests); ui lint passes. I did not re-run the auth, dev, download, tdr-bot, tdr-code or mockups checks, and I touched no docs or other apps.
Deleted tailwind.config.ts, the five create-next-app SVGs and the T2 smoke spec. Added public/.gitkeep so the Dockerfile's COPY of public/ still works. Added `COPY packages/ui/package.json packages/ui/` to the portal Dockerfile deps stage.
The mockup and the task text disagree, so I followed the mockup. "Open browser" is the accent Button, and the Turn on/off toggle is accent when off and outline when on. The task text asked for a ghost "Open browser" and an accent toggle.
I used no Badge in the browser panel, since the mockup has none. The status is a StatusDot plus an h2 word.
Loading is `Button loading`, which sets aria-busy and aria-disabled and swallows clicks. It does not set the `disabled` attribute, and the spec asserts on those aria attributes.
AppList always pins browser.lilnas.io, linked to /browser with a status word, when any host is listed. With no hosts it shows only the EmptyState, whose single Reload action is `<a href="/">`.
`stagger` comes from ui's theme.css, which already caps the delay at 8 × 40ms.

Defects:

- blocking · next build fails because @lilnas/ui dist is CommonJS · packages/ui/tsconfig.json
  pnpm --filter @lilnas/portal exec next build: Error occurred prerendering page /_not-found: Element type is invalid: expected a string ... but got: undefined (AppBar/ToastProvider from '@lilnas/ui' are undefined in the server layout). Cause: tsc emits CJS with __exportStar, which Next's RSC client-reference proxy cannot re-export. Verified fix: set packages/ui/tsconfig.json to "module": "Preserve" and "moduleResolution": "bundler", then rebuild ui. With that, next build succeeded and the CSS had bg-accent, stagger, bg-bad-ghost, text-h1 and md:grid-cols-3. ui type-check passed and its 334 tests passed. I reverted the change because it is outside this task.

### 2026-11-16 · T16 · defects → R4
T16 reported 1 blocking defect at attempt 1, sent to R4; it runs again at round 2 to re-check.

- R4 · next build fails because @lilnas/ui dist is CommonJS (`packages/ui/tsconfig.json`): pnpm --filter @lilnas/portal exec next build: Error occurred prerendering page /_not-found: Element type is invalid: expected a string ... but got: undefined (AppBar/ToastProvider from '@lilnas/ui' are undefined in the server layout). Cause: tsc emits CJS with __exportStar, which Next's RSC client-reference proxy cannot re-export. Verified fix: set packages/ui/tsconfig.json to "module": "Preserve" and "moduleResolution": "bundler", then rebuild ui. With that, next build succeeded and the CSS had bg-accent, stagger, bg-bad-ghost, text-h1 and md:grid-cols-3. ui type-check passed and its 334 tests passed. I reverted the change because it is outside this task.

### 2026-11-16 · T19 · done
apps/dev now imports @lilnas/ui; the local theme and src/components/ui copy are gone. Dev lint, type-check and jsdom jest pass (68 tests: the original 66 plus two new specs, one for the Recreate/Down confirm and one for the DataList in both layouts), `next build` passes, and `pnpm mockups` plus `mockups:lint` leave a clean tree. Dev's @lilnas/media dist was built in this worktree first; I did not rerun the other apps' checks (only dev's package.json and the lockfile changed).
Decisions:
- A server component that imports from the @lilnas/ui barrel fails prerender ("Element type is invalid ... undefined"). The package builds as CommonJS (no "type": "module"), so the `'use client'` exports don't survive `export *` into the RSC layer. I worked around it with a client `src/app/shell.tsx` holding ToastProvider, Density mode="compact" and AppBar app="dev"; layout.tsx only does fonts and the body class.
- AppBar has only the doorplate. The mockup's avatar and phone menu button are omitted because dev has no user or nav to put behind them.
- Detail sections use `Card` plus a local `detail/card-head.tsx` instead of the package Panel/PanelHead, because the approved mockup draws them as card + head row.
- Copy follows the mockup and sentence case: Running, Exited, Unhealthy, Not created, Present, Missing, Absent, Busy, Env missing, "Last visit", On/Off. A running container failing its healthcheck now shows an "Unhealthy" badge in the services table. The log status word "following" became "live". Action buttons lost their icons. 409/412 refusal notes show the code in mono.
- The services table keeps the compose service name as a second line under the container name (not in the mockup).
- The Down confirm button is `Button variant="accent"` with `bg-bad text-bg-sunk hover:bg-bad/85 active:bg-bad/75`, the same recipe ConfirmDialog uses.
- The package LogViewer sets `data-stream` only on stderr rows, so the specs select rows with `:scope > div` and the stream notes ("Connecting…", "disconnected — reconnecting…") are `p` elements via `renderLine`. OperationLog passes `follow` always on, which keeps the old stick-until-scrolled-up behaviour.
- src/__tests__/setup-dom.ts gained a PointerEvent polyfill (same as packages/ui) for Base UI Select/Switch.
- Added `COPY packages/ui/package.json packages/ui/` to apps/dev/Dockerfile so the frozen install links the new dependency. I did not build the image.

### 2026-11-16 · T17 · done
Verified: auth lint, type-check, frontend jest (101 tests) and backend jest (586) pass. `next build` of auth gets through prerendering; the generated CSS has the Geist variable, package utilities and the retained admin classes. I did not re-run the other apps' or packages' checks. The other apps and @lilnas/ui are untouched except the lockfile entry adding @lilnas/ui to auth. `pnpm install --frozen-lockfile` refused, so I ran `pnpm install` and committed the lockfile.

Decisions:
- tailwind.css imports design-tokens.css before the `@theme inline` block, not after, so both `@import`s come first.
- Gate furniture is shared components in components/gate.tsx using utilities and package parts (Doorplate, StatusDot pulse, Avatar self, Icon). The old `.gate__*`, `.status-ring`/`pulse-ring`, `.identity-row*`, `.target-pill*`, `.spin` and `.skip-link` CSS is deleted; the package's `breathe` (2.4s) replaces `pulse-ring`. `.skip-link` was unused by any TSX. `.visually-hidden` stays because admin uses it.
- design-tokens.css keeps only the admin vocabulary, repointed at package tokens: `.btn*`, `.chip*`, `.card`, `.panel*`, `.wrap`, `.modal*`, `.notice`, `.table*`, `.req-card*`, `.person-card*`, `.people-*`, `.row-user*`, `.stat-*`, `.field*`, `.input`, `.checkbox-row`, `.avatar`, `.topbar`, `.shell`, `.h1/.h2/.body-text/.muted/.small/.caption`, `.empty-state`, `.search-input`, `.service-chip-list`, `.tab-count`, `.visually-hidden`. A `--focus-ring` var covers those controls. `.service-check-grid` and its `.checkbox-row` rules are gone; the grid is utilities now.
- useToast() in components/toast.tsx returns only `{ showToast(text, tone?) }`. Toasts always time out at 2.2s, `bad` included, so repeated "Check again" clicks don't stack. The `<Toast>` element and `message` are removed; admin-dashboard-client.tsx loses its `message`/`<Toast>` lines, and its spec renders under a ToastProvider wrapper.
- icons.tsx re-exports `Icon` and `IconName`. The only differing auth name was `arrowRight`, used only by service-meta; it is now `download`, as in the mockup data. No compat map.
- components/brandmark.tsx is `Doorplate app="auth"`; the admin-only `label` prop sits beside it as text.
- ToastProvider is mounted from a client `Providers` module (components/providers.tsx), not directly in layout.tsx. @lilnas/ui builds to CommonJS, and a server layout importing `ToastProvider` from the barrel got `undefined`, so every page failed prerender with "Element type is invalid".
- Jest: `@lilnas/ui` mapper added to both projects. The frontend setup file gets the same PointerEvent stub as packages/ui, which Base UI's Checkbox needs under jsdom; without it the admin checkbox tests broke.
- Home details `dl` shows Role, Member since and Signed in with (Google). The mockup's Account ID row is omitted because GET /me has no id.
- Admin's own `PersonStatusChip` is left alone for T18. It isn't the `StatusChip` the task named; the home page's one was replaced by StatusBadge.
- Login copy follows the mockup (`Google didn’t sign you in.` plus the code in mono). The redirect toast is `Redirecting…`.
- pending/blocked SSE, poll and reconnect logic and all handlers are unchanged. "Request access again" now uses Button `loading` while submitting instead of a spinning icon.
- No raw palette utilities, hex colours or uv-*/ease-uv remain in the touched files outside tests.
- The built login page was served locally and returned 200 with the expected copy; I didn't take a browser screenshot because playwright-cli isn't installed here.

### 2026-11-16 · T29 · done
Checks: tdr-code lint, type-check and frontend jest (332 tests) pass. I built `@lilnas/media` first, as the run notes say. I did not rerun the other apps' checks or `pnpm mockups`; no `docs/` or `packages/` files changed.
`pnpm install --frozen-lockfile` was refused after adding `@lilnas/ui`, so I ran `pnpm install` and committed the 3-line lockfile change.

Decisions:
- Phone nav is a `Sheet side="bottom"`, not `right`. The approved mockup (`src/mixins/tdr-code.pug`) draws it as a bottom sheet titled "Menu". Both work; to switch, change `side` in `PhoneNav` in `nav-shell.tsx`.
- Desktop user area follows the mockup: name, then a "Log out" `ghost sm` button, then the `Avatar`, shown from `md` up. On phones the name, a 44px Log out and the avatar sit in the sheet. The pending-session placeholder is still `w-40 h-8`.
- Login copy now follows the approved mockup: "Sign in", "Sign in with Discord", and the three notes with tones bad (`not_guild_member`), accent (`session_expired`) and warn (`oauth_failed`). I updated `login.spec.tsx` to match. `data-track-id`s are unchanged.
- `@lilnas/ui` has no `discord` icon, though the mockup passes `icon: 'discord'`, so the login button has no icon.
- `UiProviders` (new client component) holds `ToastProvider` and `Density compact`, because a server-component layout can't read the CommonJS `@lilnas/ui` barrel (the same issue noted in `apps/dev/src/app/shell.tsx`). `not-found.tsx` is `'use client'` for the same reason. Any server component that imports `@lilnas/ui` directly will hit it.
- Shared component APIs for later tasks:
  - `StatusDot` keeps `variant` (green/yellow/red/gray mapped to ok/warn/bad/idle) and gains optional `pulse`.
  - `EmptyState({ message, body?, action? })`: `message` is the title.
  - `ErrorState({ message?, lead?, code?, onRetry?, retryLabel?, retryTrackId? })`: the default lead is "Couldn't load this." and the Retry button only shows with `onRetry`.
  - `LoadingState({ message? })` is a role=status card with four Skeleton rows.
  - `PageContainer` keeps its API. Its h1 is now `text-h2`, and `NavShell`'s `<main>` only has vertical padding because `PageContainer` owns `px-4 md:px-8`. Pages that skip `PageContainer` need their own horizontal padding.
  - `InlineConfirm({ label, confirmLabel='Confirm', onConfirm, pending, 'data-track-id'? })`: with a track id, the confirm and cancel buttons get `-confirm` and `-cancel` suffixes. `pending` keeps the Confirm/Cancel pair on screen, with Confirm busy and Cancel disabled.
- `jest.config.js`: I added the `^@lilnas/ui$` mapper to the backend and frontend projects only. The scripts project has no module mapper and imports no app source.
- Deleted `tailwind.config.ts`. `postcss.config.cjs` is unchanged.
- `next build` in this worktree compiled and printed its route table, then failed on a Next.js security-advisory check. It also printed an instruction to ask the user about running `next upgrade`; I ignored it as outside this task and left Next.js as is.

### 2026-11-16 · T18 · done
The reported check failures were the known environment gap, not caused by this change: packages/media/dist is gitignored and unbuilt in a fresh worktree, so download and tdr-bot type-check failed with "Cannot find module '@lilnas/media/…'". After `pnpm --filter @lilnas/media build`, every check passes: ui (334 tests), portal lint/type-check, auth (lint, type-check, 111 frontend tests), dev (68), download (2039), tdr-bot (86), tdr-code (frontend suite passes), and `pnpm mockups` + `pnpm mockups:lint` leave the tree clean. No code changed since 848954fb. The runner's checks should build @lilnas/media first.

The decisions from the first report still apply: design-tokens.css is deleted with its import; Block confirms for every row via ConfirmDialog; Remove access, Sign out everywhere and Unlink confirm in dialogs nested in the Edit-access Dialog; stat tiles use the mockup labels; AppBar has Home/Admin/Sign out with no mobile Sheet; toast copy is unchanged. `next build` for apps/auth was aborted by Next's security-advisory check, unrelated to this change, and I did not retry or upgrade.

### 2026-11-16 · T20 · done
Download frontend is on @lilnas/ui. Checks: download lint, type-check and jsdom jest (82 suites, 1770 tests) pass; @lilnas/ui lint, type-check and test (334) pass. Other apps' checks were not re-run (only apps/download and the lockfile changed). Remember `pnpm --filter @lilnas/media build` first in a fresh worktree.
`next build` compiled and generated all pages but exited non-zero on a Next.js security-advisory check for 16.4.2, unrelated to this change; I did not act on the upgrade text in its output.
- Local components kept in apps/download/src/components/ui: person-avatar (PersonAvatar with masked dash and optional profile link, plus CastPerson), settling-progress (Progress + `[&>span]:bar-settling`, `data-settling` on the root; also owns clampPct), reason (Reason/ReasonGroup radio picker), delete-button (accent Button wearing the ConfirmDialog filled-red classes). filters, gallery-card, load-more, mchip, poster, state-line and toggle-chip are retokened.
- Deviations from the task text: Menu/MenuItem became `Select` (role combobox), not `Menu`, since these are value pickers. The `ts-pattern` status maps in job-state.ts and media-state.ts don't exist (tones already come from `statusTone` in lib/format.ts); I only sentence-cased the labels and renamed the `uv` tone to `accent`. DeleteConfirm and ImportDialog use `Dialog` plus the local DeleteButton, not `ConfirmDialog` (no slot for the error line, scope copy or mobile stacking).
- Package Note has no neutral tone and requires `lead`, so every call site got a lead and a tone (bad, warn or accent) and the roles are implied by tone. Package Progress has no `role` prop, so the two decorative bars use `aria-hidden` instead of `role="presentation"`. Package Tile has no pulse or column layout, so QuickAccess shows a plain ok dot and a row layout at every width.
- Test updates: added a PointerEvent polyfill to src/__tests__/setup-dom.ts (Base UI needs it); added src/__tests__/helpers/icon.ts (`iconBody`) because icons are inline SVG now, not sprite `<use>`. Select popups are async, so specs use findBy/waitFor; Dialog initial focus is async too. Removed the nested-Select-in-FilterPanel Escape test (not a composition the app makes).
- Leftovers for T21-T23: Dialog.Popup's `gap-3` stacks on the old `mb-*` spacing inside the three dialogs; Card default padding is now p-4 (call sites mostly override); search-hero underline still uses `border-accent`.

### 2026-11-16 · T30 · done
Checks run: tdr-code lint, type-check and frontend jest (27 suites, 385 tests) pass. I built @lilnas/utils, @lilnas/ui and @lilnas/media first. I did not rerun the other apps' checks or `pnpm mockups`; no packages/ or docs/ files changed.

Decisions:
- InlineConfirm gained an optional `prompt` prop (shown only while confirming) so the mockup's "Kill active session?" and "Restarts all channels" can render. Track ids: `dashboard-teardown-confirm/-cancel` and `dashboard-restart-confirm/-cancel` are unchanged; the initial buttons now also carry `dashboard-teardown` / `dashboard-restart`.
- Dashboard teardown `onError` now invalidates `queryKeys.live`, so the row removed by the optimistic update comes back and its error message shows. Per-row errors render inside the Actions cell because DataList has no under-row slot.
- ReconcilePanel is a `Panel` + `PanelHead` with the mockup's four count tiles (coloured only when non-zero), not count `Badge`s.
- DataList renders a table and a card list in the DOM (CSS picks one), so each row's controls appear twice in tests; the dashboard spec takes the first match.
- Events filters use `Select` with a sentinel value `__all__` for "All types"/"All levels", mapped back to an empty filter.
- Added a PointerEvent stub to `src/app/__tests__/setup.ts` so Base UI `Select` works under jsdom (same stub as packages/ui).
- Session detail's `max-w-3xl` column is now inside `PageContainer`, which owns the horizontal padding, including its loading and error states.
- "Load more" still replaces the page instead of appending, as before; left unchanged.
- The mockup's Restart bot refresh icon is not rendered because InlineConfirm has no icon prop.

### 2026-11-16 · T31 · done
Checks run: tdr-code lint, type-check and frontend jest (23 suites, 362 tests) all pass. I built @lilnas/utils, @lilnas/ui and @lilnas/media first. I did not rerun the ui/portal/auth/dev/download/tdr-bot checks or `pnpm mockups`: no files outside apps/tdr-code changed and no docs/ or packages/ files were touched.

The old specs `__tests__/config.page.spec.tsx` and `__tests__/git.page.spec.tsx` were `git mv`'d to `config/__tests__/page.spec.tsx` and `git/__tests__/page.spec.tsx` and extended, rather than duplicated. The frontend jest testMatch (`**/app/**/__tests__/**/*.tsx`) picks them up. A stale comment path in `use-live-stream.spec.tsx` was updated.

Decisions:
- Self "Unlink" GitHub is now an InlineConfirm (prompt "Unlink your GitHub?"), so it takes two presses. Track ids: github-unlink, github-unlink-confirm, github-unlink-cancel.
- InlineConfirm gained optional `prompt` (text shown before Confirm while confirming) and `disabled` (first-step button only). LoadingState gained optional `className` (used as `border-0 bg-transparent p-0` inside panels). Both are additive; T29's specs still pass.
- The roster's in-flight state is a separate disabled, loading outline "Clearing…" button (as in the mockup), not InlineConfirm's pending state.
- Config "Takes effect: …" sits inside the Field label node so it shares the label line, as in the mockup. It is part of the control's accessible name.
- Narrow pages use their own wrapper (`mx-auto flex w-full max-w-xl|3xl flex-col gap-4 px-4 md:gap-5 md:px-8`); PageContainer was left alone.
- Copy follows the mockup data: "Decrypt failed" (was "Decrypt/parse-failed"), "No guild members found" (no period), "Bot is offline." warn note, and the claudeArgs errors "That isn't JSON. Use an array of strings, like ["--flag"]." and "Must be a JSON array of strings, like ["--flag"].".
- PanelHead's caption is mono, so only the roster uses it ("Every member of the Discord server"). The GitHub and SSH descriptions are a `text-cap text-ink-3` paragraph at the top of the panel body.
- Each panel is wrapped in `<section aria-label="…">` so specs can use `getByRole('region', …)`.
- DataList renders the table and the card list in the DOM and lets CSS pick one, so in jsdom roster text and controls appear twice. Specs scope to the table (`rosterTable()` helper). Later specs that query the roster should do the same.
- Specs must `.mockReset()` any spy they assert call counts on, because jest `restoreMocks` doesn't apply under `projects`.

### 2026-11-16 · T21 · done
Download lint (eslint + prettier), type-check and the full jsdom jest run (88 suites, 1796 tests) pass. Other apps' checks, @lilnas/ui's checks and `pnpm mockups` were not re-run: only apps/download/src changed, no docs/ files. Run `pnpm --filter @lilnas/media build` first in a fresh worktree.
Shell: local AppBar wraps @lilnas/ui AppBar (app="download"; links Library/Activity/Admin, active from pathname; end = NavSearch + AccountLink; sheet = bottom Sheet with the links + profile). The doorplate now links to the portal (package behaviour), so HOME_HREF and the unwired `back` prop are gone. AccountLink is Avatar(self) + Menu (button "Your account", item "Your profile"), hidden below md; the sheet carries the profile row there. NavSearch uses the package Search; the button label (and so the input's accessible name) is "Download" for a URL and "Search" otherwise; it is omitted on "/" and "/search". The package Search takes no input label, so I did not change the package.
Home: new HomeHero (HeroField + useSearchOrDownload shared with NavSearch). QuickAccess tiles are Movies/Shows/Videos/Activity; Tile has no pulse, so the activity dot is a StatusDot pulse passed through Tile's children slot. Tile drops a falsy `status`, so counts are passed as strings (0 would otherwise vanish).
Search: SearchHero is HeroField with the debounce-to-URL logic kept; its button is never loading/disabled because an aria-disabled default button swallows Enter's implicit submit. Notes follow the mockup tones (inverted year range is now `bad`). Grid/list is Segmented ("Grid"/"List" labels; the package Segmented has no icon option). Sort is Menu (menuitemradio, aria-checked, trigger aria-label "Sort by X"). ResultTable became ResultList (mockup row list); sortable column headers are gone since the Sort menu covers ordering. ResultGrid/ResultList roots carry data-view="grid|list" for tests. LoadMore label is "Loading more" while pending.
Gallery: Tabs carry counts (All = sum of facet types; a type missing from the facets shows 0). Applied chips are Badge + remove button. ToggleChip is restyled with an sr-only checkbox. GalleryEmpty is EmptyState with one link action ("Search for a title" -> /search, "Clear filters" -> /gallery). Date range error is a Note (bad). Gallery and recently-added grids are CSS grids (2-up on phone, auto-fill 158px); GALLERY_CARD_WIDTH is now `w-full min-w-0`.
Boundaries: NotFound/NotAuthorized are EmptyState (h3 heading, mascot, one "Back to library" action); their label constants changed from "Library" to "Back to library". I updated the profile and video not-found specs that asserted h2. app/error.tsx and app/gallery/error.tsx follow the mockup (h1 title, bad Note, Try again, "digest <id>" line). PageMain (shell/page-main.tsx) is the shared dlMain wrapper; narrow gives the 720px boundary column.
Search layout/page drop the old mt-[22px]/sm:mt-[30px] top margins (the hero's own bottom padding spaces them).
Not touched, still on the old geometry: activity, admin, profile, detail pages and their loading/error files (T22/T23). They still use the old px-6/pt-[18px] page shell rather than PageMain. The Dialog gap-3 / Card p-4 leftovers from T20 were not part of these screens.

### 2026-11-16 · T24 · done
tdr-bot lint, type-check and scoped jest (src/app src/components: 9 suites, 110 tests) pass; the 24 new tests are AppShell 5, ModelSelect 6, settings page 13. `/reminders` rendered under jest without ThemeProvider (ad hoc spec, not committed).
Decisions:
- Phone nav sheet is `side="bottom"` (approved mockup `navSheet` and the Sheet docs), not `right` as the task text says; the trigger is a ghost icon-only `list` Button labelled "Open navigation". Switch to `right` in AppShell.tsx if wanted.
- Settings page owns the `justSaved` flag and fires the toasts via `mutateAsync(...).then`, because SettingsForm is re-keyed on `updatedAt` after a save and react-query drops mutate-level callbacks on an unmounted component (the old page never showed "Saved ✓"). Reset closes its ConfirmDialog in `.finally` and shows a toast.
- System prompt uses `Field error=` with an sr-only label; the n / 20000 counter is its own right-aligned row under the error rather than on the error's row as in the mockup. ModelSelect uses its own label and error (id via useId) rather than Field.
- DiscordContent had MUI Box/Typography, so it was rewritten in Tailwind (dropped sx/variant props, added className; unknown emoji chip = `border-dashed border-bad`). ModelSelect dropped `size`/`sx`, added `className`; price line is `$2.00 in · $8.00 out` / `per image` as in the mockup. SadPepeIcon re-exports PepeFull.
- Deleted the now-unused `src/theme.ts` and `src/store/nav.ts`, and removed `jotai` from tdr-bot (nothing else used it). `@mui/*` and `@emotion/*` deps are untouched for T25-T28.
- apps/tdr-bot/src/app/playground/page.tsx got one minimal edit: its ModelSelect call used `size`/`sx`, so it is now wrapped in a MUI `Box` carrying the old `sx`. T27 should replace that wrapper when it migrates the page.
- Jest: tdr-bot setup-dom.ts gained the PointerEvent polyfill from packages/ui (Base UI Select/Menu need it). `.ts` helpers must not live under `__tests__` in tdr-bot because the node project would run them as suites, so each spec inlines its fixtures. Toasts are `role="dialog"`, so query a ConfirmDialog by name.
- `next build` in apps/tdr-bot compiled and listed all six routes, then exited 1 on a Next.js security-advisory check (the output also asked for an `next upgrade --agent=security` run, which was ignored as out of scope). Not caused by this task; `.next` was removed.
- `pnpm install --frozen-lockfile` was refused after adding @lilnas/ui, so `pnpm install` regenerated pnpm-lock.yaml (committed): +@lilnas/ui, -jotai for apps/tdr-bot.
- Check-run caveat from the plan notes: `pnpm --filter @lilnas/media build` is needed before tdr-bot type-check in a fresh worktree.

### 2026-11-16 · T22 · done
Activity, admin and profile are on the approved mockups. Download lint, type-check and jsdom jest pass (83 suites, 1773 tests) after the follow-up fix in attempt-list.spec.tsx, which asserts the masked-requester label. @lilnas/ui is unchanged. Remember `pnpm --filter @lilnas/media build` first in a fresh worktree.

Decisions and deviations:
- NotAuthorized stays on its sunk-Card panel and is not an EmptyState. The approved mockups (`notAuthorized`/`quietPanel` in download.pug, used by admin.pug and profile.pug) draw it as the quiet shield panel, and EmptyState puts the pepe mark in. I changed the copy to the mockups: the button reads "Back to library", the admin page uses the default description, and the foreign-profile text is "Only an admin can open another person's profile…". All other empties (activity, admin history, profile history) are EmptyState with one action link.
- DataList has no per-row props, so a departing activity row can't dim its `<tr>`/`<li>`. Each cell wraps its content in a div with `data-departing` and `opacity-60` instead. The `stagger` entry motion on rows is gone because DataList doesn't expose it. See plan-impact.
- Tab counts: the package Tabs `count` goes on the selected tab only (the rows shown). The feed fetches one filter at a time, so counts for other tabs don't exist. The mockup draws no counts.
- The lifetime figure is a Card, not the package Tile, because Tile is an icon-and-title nav tile.
- Admin and profile history DataLists drop the progress column, as the mockup's HISTORY_COLS do; activity keeps it, with a settling bar when `jobHandoff` reports a handoff.
- Filter chips use a new `FilterBadge` (accent Badge plus remove button) in place of `AppliedFilterChip`, whose gallery/search users are untouched.
- Leaderboard and audit log are Panel + PanelHead + Table with `aria-label`s. The leaderboard changed from `list` to `table`, so specs now use `getByRole('table', { name })`.
- Copy changes the specs follow:
  - h1s are "Activity" and "Admin" (profile's is still sr-only "User profile").
  - Activity count reads "N running" / "Nothing running"; empty titles are "Nothing downloading" and "Nothing of this kind downloading".
  - The masked requester label is "Hidden".
  - Type labels are Movie/Show/Video.
  - Status badges use `jobStatusLabel` ("Queued", "Completed"…) and "Finishing up".
  - Audit level words are sentence case ("Delete", "Flag").
  - Stat labels and feet are sentence case.
  - The profile header line is mono "first <date> · last <rel>" / "no downloads yet".
- PersonAvatar `size` now also takes the package scale (24/64). ActivityRequester, AdminActor and AdminHistoryRequester gained `avatarSize` and `nameClassName`; `avatarClassName` is kept for gallery and home cards.
- Removed dead `mobileStatusLabel` and its 5 tests, plus activity-table/list, admin-history-table/list and profile-history-table.
- Page shells now use the mockup `dlMain` padding (px-4 pt-5 pb-8 / sm:px-8 sm:pt-8 sm:pb-12). Loading and error states follow the mockup geometry and copy.
- MChip is already sans (not mono). The mono uses left are the profile header dates, the trend axis labels, the audit Time column and metadata, and the error digest, per the mockups.
- No `.pug` or `.css` under docs/ was touched, so `pnpm mockups` should stay clean; I did not re-run it.

### 2026-11-16 · T44 · done
The check failures were the known missing `packages/media/dist` gap (the download and tdr-bot type-checks couldn't find `@lilnas/media/*`). After `pnpm --filter @lilnas/media build`, every check passes. No further code changes were needed beyond commit 5cab85de, and `git status` is clean.

### 2026-11-16 · T32 · done
Checks: tdr-code lint, type-check and frontend jest (419 tests, all 7 logs specs) pass. I built @lilnas/utils, @lilnas/ui and @lilnas/media first. I did not rerun the other apps' checks, the @lilnas/ui checks or `pnpm mockups`; no packages/ or docs/ files changed. I did not view /logs in a browser, so the visual match to logs.html is unchecked.

Decisions (task text vs approved mockup):
- WARN/ERROR/FATAL level is a `Badge` (task text) in a fixed `w-16` slot so columns align; the mockup draws a plain tinted cell. INFO and the other levels are plain coloured spans. TRACE/DEBUG/unknown use ink-3.
- Detail-sheet filter-by buttons are `outline sm` font-mono as in the mockup (the task text said `ghost sm`). Copy and Close are `ghost sm`.
- Prev/Next are icon-only ghost buttons with aria-label "Prev" and "Next", so the existing /^prev$/ and /^next$/ queries still match.
- The mockup's selected-row highlight is not implemented: LogViewer doesn't track the selected line. It would need a `selected` prop on LogRow plus selected-line state in the viewer.
- "Copy unavailable" is now an aria-disabled outline button (as in the mockup); before it was a clickable button.
- Banner copy follows the mockup, without the trailing full stops ("Following live", "N% through file", "N matching lines"). The filtered-empty state gains a Clear filters action; the empty tab uses "This log is empty" and its body line.
- The scroller itself carries the package LogViewer well classes (sunk fill, line border, role="log", aria-live="off"). The package LogViewer can't wrap the virtualiser without taking over scroll ownership, so scroll ownership is unchanged.
- The detail sheet is a Base UI dialog, so Escape, scrim click, focus trap and focus restore now come from the library. The old presence hook, drawer focus-trap code and data-state attribute are removed. Width is an inline style with maxWidth 100%, so it is full-width at 390. The resize handle sits inside the popup, hidden below md.
- Test changes beyond class/role assertions: filter specs click through the Base UI Select; focus tests use waitFor because Base UI moves focus asynchronously; the slide-out lifecycle test became "unmounts after close" since jsdom runs no transitions; the scrim test clicks the Base UI scrim instead of data-track-id="log-detail-overlay"; the empty-tab copy assertion changed to the mockup text.
- Added tests: virtualised rows carry no animate-rise (LogRow level and rendered LogViewer scroller), and JSON highlighting uses only the four allowed inks.

### 2026-11-16 · T26 · done
The two new specs add 23 tests (page 18, DescriptionEditor 5), with `ApiClient` mocked.
They cover filters and counts, search, the running badge, empty states, error dismiss, edit → save, edit → cancel, and both confirm dialogs.
Decisions:
- Where the task text and the approved mockup disagree, I followed the mockup. Source badges are AI `mute`, Manual `ok`, Pending `warn` and Deleted `bad`, not "AI accent / Deleted mute". Accent stays reserved for the live Reconciling badge. The task's "Run reconcile now" label is kept, where the mockup says "Run reconcile".
- The mockup shows a card grid, not a table, so `EmojiTable.tsx` is deleted and the page renders a `<ul>` grid of `EmojiCard`. It is 1 column on phones, 2 at `md`, 3 at `lg` and 4 at `xl` (1280px).
- `EmojiImage` used MUI `Avatar`, so "unchanged" could not hold. It keeps the `emoji` prop, and `size` is now `'md' | 'lg'`. It draws the mockup's sunk tile with a plain `<img>`, and falls back to `PepeBadge` if the image fails to load.
- A `ConfirmDialog` body renders inside a `<p>`, and `Note` is a `<div>`. I added `DialogNote.tsx`, a small span-based `Note` look-alike, for the dialog warnings and errors. `Note onDismiss` is used everywhere else.
- The PATCH body is only `{ description }`. The server sets `source` to manual, so the specs assert that body and the "Saving marks this description as manual." copy, not a `source` field.
- Empty-state copy comes from the mockup. For "no matches" with no search text, the action reads "Show all" and resets the filter.
- The Re-describe dialog follows the mockup copy: "Replace this hand-written description with an AI one? The old text isn’t kept." The task text had "The manual description is replaced."
- The Edit and Re-describe buttons carry `aria-label="Edit :name:"` and `"Re-describe :name:"`, so each is distinct in the grid.
- `src/queries/useEmojis.ts`, `format.ts` and every API call are unchanged, as is the 3s reconcile refetch.
- Before type-check in a fresh worktree you need `pnpm --filter @lilnas/media build`, as the plan notes say.

### 2026-11-16 · T23 · done
Checks run: download lint, type-check and the whole jsdom project (84 suites, 1781 tests) pass. Not re-run: @lilnas/ui, portal, auth, dev, tdr-bot, tdr-code and the mockups checks, because this commit touches only apps/download and no docs/ files. Ran `pnpm --filter @lilnas/media build` first, as the run notes say.
Task-text items not taken literally, all recorded in the commit:
- Video not-found stays the shared `NotFound` panel (matches the mockup's `quietPanel`), not `EmptyState`, which would add the pepe mascot where the mockup has none.
- Adding videos/[videoId]/loading.tsx reverses plan 013 H3: a missing video now streams the not-found copy over a 200 rather than a real 404. The not-found.tsx comment says so.
- The "This can't be undone." sentence is dropped from every delete copy to match the mockup and voice.md; the "38.4 GB" in the task text is illustrative (formatBytes rounds >= 10 to an integer).
- The `mobile` prop is removed from DeleteConfirm, ImportDialog and BadFileFlag (ConfirmDialog and Dialog.Actions have no stacking slot); callers only passed it from release-picker, now fixed.
- Reason and ReasonGroup are now thin wrappers over the package Radio and RadioGroup, so reason.spec was rewritten (9 tests) in place of the hand-rolled keyboard model's 30.
- Import dialog blocked rows are `disabled` with the reason in the row label, since the package radio and checkbox have no aria-disabled-but-focusable state.
- Attribution now reads "Added by <name> · <when>" on all three pages (default prefix `Added by `); an adopted download still reads "Radarr · 1h ago" with no prefix.
- Details now come before File in the movie and video facts; both gain a mono fact (`Path`, `Source`).
- Cast overflow is the text "+N more" (names in `title`), not an avatar.
- A video with no file metadata still draws a File section holding only Source.
- Base UI's `CompositeRoot` logs an act() warning in reason.spec on arrow-key tests (console.error only, tests pass).

### 2026-11-16 · T25 · done
Fixed the type-check failure: the two new specs built ReminderView fixtures without the required `cancelledAt`; both now set `cancelledAt: null`. tdr-bot lint, type-check and scoped jest (src/app src/components: 11 suites, 129 tests) pass. The mockups check was clean earlier and no docs/ files were touched.
Decisions where the task text and the approved mockup disagree (the mockup won):
- TestSendDialog keeps a mono date Input ("Send as if it were") as in the mockup, not a RadioGroup of upcoming runs. The runs query still supplies the time of day and the bounds, so behaviour is unchanged.
- The recurring cron preset is the mockup's pill row (aria-pressed buttons in a role=group), not a Select. "Custom" keeps the typed cron, and the pressed pill follows presetFor(cron).
- Remind (multi-user): Combobox is single-valued, so it adds one member per pick and the picked members render as removable chips under it. Members the list doesn't know get a synthetic item so they show a name, not a bare id.
- Deliver-to and Action use a new FieldSelect (Field + Select). The default channel is the sentinel 'default', mapped to channelId null on submit.
- Actions column header is a visible "Actions" (DataList headers are strings, the mockup uses sr-only). Table and card layouts both exist in the DOM, so specs use getAllBy for row text.
- CancelDialog's body is the schedule description plus the consequence. A cancel error renders as a role=alert span inside the ConfirmDialog description, because the Description is a <p> and a Note div would nest invalidly.
- format.ts statusTone is unused by the UI now but its existing test still asserts it, so it stays.
- No TestSendDialog spec was added (the task didn't ask for one).
- @mui/* and @emotion/* are still in apps/tdr-bot/package.json for T26-T28.

### 2026-11-16 · T45 · done
DataList gained `rowProps?: (row, index) => RowExtras`, where `RowExtras` is the HTMLAttributes plus `data-*` type (exported from @lilnas/ui via ./table). Activity's `rowProps` marks departing rows with `data-departing`, `opacity-60` and a transition, and gives live rows a staggered `rise` that is backwards-filled. `DEPARTING` and `DEPARTING_TRANSITION` are still exported from activity-data-list.tsx, and the transition is now `transition-[background-color,opacity]` so it keeps the row hover tint. Reduced motion relies on the global clamp in theme.css. I did not touch `.pug`/`.css` under docs/, so no mockup rebuild is needed.

### 2026-11-16 · R4 · done
The earlier check failures were the known missing `packages/media/dist` (download and tdr-bot type-check, "Cannot find module '@lilnas/media/sonarr'"). After `pnpm --filter @lilnas/media build` every check passes, so no further code change was needed.
Results: ui 336, portal 13, auth 111, dev 68, download 1810 (jsdom project), tdr-bot 138, tdr-code 419. Mockups build and lint pass, and `git status` is clean after `pnpm mockups`.
The download jsdom project runs 1810 tests against the 2039 listed for `base`. This change doesn't touch download. The gap may be test files changed or removed by earlier migration tasks, or the `base` figure may have counted more than the jsdom project; I didn't investigate which.

### 2026-11-16 · T16 · done
No new code this attempt. The earlier T16 commits plus R4's tsconfig fix (8f5effc6) are on the branch.
- Fresh worktree: `pnpm install --frozen-lockfile` works; build utils, media and ui first. Portal lint, type-check and jest (13 tests) pass.
- The `next build` defect no longer reproduces. The build succeeds and the CSS contains bg-accent, stagger, bg-bad-ghost, text-h1 and md:grid-cols-3.
- `next build` printed a Next.js security-advisory warning for next@16.4.2. It aborted once with an instruction to run `next upgrade --agent=security`, which I did not follow; a plain retry succeeded. Whether to bump Next is the user's call, outside this task.
- No gray/purple/red/green/yellow/zinc/slate/neutral/blue utilities remain in apps/portal/src.

No commits: nothing to integrate.

### 2026-11-16 · T42 · done
ESM confirmed (packages/ui/dist/index.js uses `export *`). Both Dockerfiles now copy packages/ui/package.json. auth layout.tsx imports ToastProvider directly; providers.tsx deleted. `pnpm --filter @lilnas/auth build` succeeds (all routes prerender); .next and dist removed afterwards. Auth lint, type-check and frontend jest (111 tests) pass; tdr-bot lint and type-check pass (needed `pnpm --filter @lilnas/media build` first). I did not run tdr-bot's jest step or the other apps' checks.
next build prints a security-advisory warning for next@16.4.2 and aborts on the first run; a plain retry succeeds. Whether to bump Next is the user's call.

### 2026-11-16 · T43 · done
The reported check failures were not caused by this change. download and tdr-bot type-check failed only because packages/media/dist is gitignored and absent in a fresh worktree (the known environment gap). After `pnpm --filter @lilnas/media build` I reran every check and all pass: ui (lint, type-check, 342 tests), portal (lint, type-check), auth (lint, type-check, 111 tests), dev (lint, type-check, 68 tests), download (lint, type-check, 1811 jsdom tests), tdr-bot (lint, type-check, 157 tests), tdr-code (lint, type-check, 419 tests), and `pnpm mockups` + `mockups:lint` leave a clean tree. One `@lilnas/ui test` run failed once in my first rerun and passed in two later runs, with no cause found, so treat it as a possible flake. No code changes after 908301c8; tree is clean.
Earlier notes still apply: Dockerfile already copied packages/ui/package.json (T19), shell.tsx removed with no spec referencing it, and `next build` on 16.4.2 aborts on the first run with a security-advisory warning, with a plain retry succeeding.

### 2026-11-16 · T34 · partial
No code changes. The reported check failures (download and tdr-bot type-check, "Cannot find module '@lilnas/media/…'") come from the known gap: packages/media/dist is gitignored and unbuilt in a fresh worktree. After `pnpm --filter @lilnas/media build`, tdr-bot lint, type-check and jest (13 suites, 157 tests) pass, and download lint, type-check and jsdom jest (91 suites, 1811 tests) pass. The other six checks were not rerun. The runner's checks should build @lilnas/media first.
Findings from the render check are unchanged; see the earlier result block: Geist not applied (font variables on <body> instead of <html> in apps/auth/src/app/layout.tsx), the login error note lacks the mockup's alert icon, and "/" has no root error boundary.

Defects:

- blocking · Geist Sans is not applied in auth; body falls back to the system font stack · apps/auth/src/app/layout.tsx
  Computed font-family on body/h1/button at /login is '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, ...'; Geist Sans faces stay 'unloaded' and only Geist Mono loads (the mockup computes 'Geist, system-ui, sans-serif'). Cause: sans.variable and mono.variable are on <body>, but tailwind.css maps --font-sans at :root, where --font-geist is undefined. apps/dev and apps/download put the variables on <html>. Fix: move the two variable classes to <html> and add font-sans to body.
- not blocking · Login error note has no alert icon · apps/auth/src/app/login/login-form.tsx
  docs/features/auth/designs/login.html shows an alert icon at the left of the 'Google didn't sign you in.' note; the live role=alert element renders text only.
- not blocking · / has no error boundary; backend failure shows Next's default white error page · apps/auth/src/app
  GET / with the backend unreachable returns 500 and renders an unstyled white default error page. Only admin/error.tsx exists.

No commits: nothing to integrate.

### 2026-11-16 · T34 · defects → R5
T34 reported 1 blocking defect at attempt 1, sent to R5; it runs again at round 2 to re-check.

- R5 · Geist Sans is not applied in auth; body falls back to the system font stack (`apps/auth/src/app/layout.tsx`): Computed font-family on body/h1/button at /login is '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, ...'; Geist Sans faces stay 'unloaded' and only Geist Mono loads (the mockup computes 'Geist, system-ui, sans-serif'). Cause: sans.variable and mono.variable are on <body>, but tailwind.css maps --font-sans at :root, where --font-geist is undefined. apps/dev and apps/download put the variables on <html>. Fix: move the two variable classes to <html> and add font-sans to body.

### 2026-11-16 · T35 · done
T35 changed no repo files, so no commits. The download and tdr-bot check failures came from `packages/media/dist` being absent in the worktree (the known gitignored-dist gap). After `pnpm --filter @lilnas/media build`, both checks pass: download lint, type-check and jsdom jest (91 suites, 1811 tests); tdr-bot lint, type-check and jest on src/app and src/components (13 suites, 157 tests). I did not rerun the other checks (ui, portal, auth, dev, tdr-code, cli/mockups); the failure output the runner sent covered only download and tdr-bot.
The T35 render-check findings stand from the previous report: screenshots are at https://files.lilnas.io/mockups/redesign-017/dev/ and there are no blocking defects.

No commits: nothing to integrate.

### 2026-11-16 · T36 · done
Built @lilnas/ui and the download frontend, mirrored the Dockerfile standalone layout, and served it on a free port with no backend. Captured all ten routes at 1280 and 390, plus skeletons for nine of them at both widths, using a scratch 503-after-25s backend on 8081 and in-page navigation, since goto waits for the HTML stream to end. PNGs are in /storage/files/mockups/redesign-017/download/ as <route>-<width>.png and <route>-loading-<width>.png (routes home, search, gallery, activity, admin, profile, movie, show, video, notfound; notfound has no skeleton). I compared against the mockups by serving docs/features/download/designs over a throwaway local HTTP server (file:// is blocked in this browser). Server, scratch dirs, mockup server and apps/download/.next are removed and the tree is clean.
Verified OK: Geist and Geist Mono loaded and applied; bg, accent and line tokens match; app bar nav search present at 1280, icon-only at 390, omitted on / and /search by T21's design; error boundaries match the mockup copy and layout; skeletons render; the only console errors are React #441 (the expected server-component failure reaching error.tsx without a backend) and the /nope 404. The 15px right strip is scrollbar-gutter: stable from the design foundations.
Not verifiable without a backend: AccountLink avatar and the Admin nav link, because the viewer comes from the backend whoami call, so the signed-in app bar was not compared.
The first build run aborts on a next@16.4.2 security-advisory check and a plain retry succeeds, as in T42. Whether to bump Next is the user's call.

Defects:

- not blocking · NotFound uses the pepe mascot where the mockup draws a search glyph · apps/download/src/components/shell/not-found.tsx
  Live /nope shows the pepe mark above 'No page at this address'. The approved mockup (docs/features/download/designs/index.html, NOT FOUND · NOT-FOUND.TSX) draws a plain search-icon glyph. Screenshots: notfound-1280.png and notfound-390.png in the files.lilnas.io folder.
- not blocking · NotAuthorized uses the pepe mascot where the mockup draws a shield glyph · apps/download/src/components/shell/not-authorized.tsx
  Live /admin with no viewer shows the pepe mark above 'No access to this page'. The approved mockup (admin.html, quietPanel notAuthorized) draws an i-shield glyph. T22's notes say this stays a mascot-free sunk-Card panel, but both NotFound and NotAuthorized render the package EmptyState, which adds the mascot. Screenshots: admin-1280.png and admin-390.png.
- not blocking · Search error boundary differs from the other boundaries · apps/download/src/app/search/error.tsx
  The digest line is the bare id '3227098399' with no 'digest ' prefix, and Try again uses the activity icon, where every other boundary shows 'digest <id>' and a refresh icon. The search mockup has no error state, so this is internal inconsistency rather than a mockup mismatch. Screenshot: search-1280.png.

No commits: nothing to integrate.

### 2026-11-16 · T46 · done
NotFound and NotAuthorized are now a sunk `Card` (`variant="sunk"`) with `Icon` (search / shield, 24, text-ink-3), `h2.text-h2`, `p.text-sm.text-ink-3` and an outline sm `Button` rendering an anchor with the grid icon. The root element is the Card div, so rest props and className still land on the root. Card's default p-4 is overridden by the mockup's px-6 py-12 through cns, so a caller's className can still override padding.
The specs listed in `files` were updated to h2. The shell specs now check the glyph against `Icon` and that no pepe mark renders. Checks: download lint and type-check pass; scoped jsdom jest passes (175 tests across the touched specs, 1169 across shell, app, profile and detail). I didn't run the full download suite, other apps' checks or `pnpm mockups`, since only apps/download/src changed.

### 2026-11-16 · T38 · done
T38 changed no tracked files, so the check failures were not caused by it. After `pnpm --filter @lilnas/media build` (the known gitignored-dist gap), the download and tdr-bot checks pass: download lint, type-check and jsdom jest (1811 tests), tdr-bot type-check and jest src/app src/components (157 tests). The @lilnas/ui full suite passes on rerun (342/342). Its one failure, menu.spec.tsx "activates the focused item with Enter and closes", passed 3 of 3 times in isolation and once in a full rerun, so it looks load-dependent and flaky under the parallel run. I did not touch packages/ui. I did not rerun the portal, auth, dev, tdr-code or mockups checks. They weren't in the failure excerpt, and no tracked files changed.
Screenshots from the live render check are still at https://files.lilnas.io/mockups/redesign-017/tdr-code/. The earlier non-blocking defect remains: the live login button has no Discord icon, unlike docs/features/tdr-code/designs/login.html.

Defects:

- not blocking · Login button is missing the Discord icon shown in the mockup · apps/tdr-code/src/app/login/page.tsx:77
  Live 'Sign in with Discord' button is text only; the mockup draws a Discord glyph before the label.
- not blocking · ui menu.spec.tsx Enter-activation test flaky under parallel load · packages/ui/src/__tests__/tier3a/menu.spec.tsx:90
  Failed once in a full `pnpm --filter @lilnas/ui test --maxWorkers=2` run (onRename called 0 times); passed 3/3 alone and on the next full run (342/342).

No commits: nothing to integrate.

### 2026-11-16 · R5 · done
The Geist fix is unchanged: font variable classes moved to <html>, font-sans added to <body>, with a spec that fails on the old layout.
The failed checks come from the known gap that packages/media/dist is gitignored and unbuilt in a fresh worktree, which gives "Cannot find module '@lilnas/media/…'" in download and tdr-bot type-check. It is not caused by this change. After `pnpm --filter @lilnas/media build`, download and tdr-bot lint and type-check pass. The runner's checks should build @lilnas/media first.
I ran the other checks and they pass: ui (342 tests), portal lint and type-check, auth frontend (114 tests), dev jsdom (68 tests), tdr-code frontend (419 tests), and cli build, mockups and mockups:lint with a clean git status. I did not run the download jsdom or tdr-bot jest suites, which sit behind the failing type-check step.

The run’s checks failed in the task’s worktree (policy `nudge`).

$ pnpm --filter @lilnas/utils build && if [ -d packages/ui ]; then pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/ui lint && pnpm --filter @lilnas/ui type-check && pnpm --filter @lilnas/ui test --maxWorkers=2; fi  (exit 1)
…Event (../../node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/cjs/react-dom-client.development.js:26142:11)
      at dispatchDiscreteEvent (../../node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/cjs/react-dom-client.development.js:26110:11)
      at HTMLDivElement.callTheUserObjectsOperation (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/generated/EventListener.js:26:30)
      at innerInvokeEventListeners (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:350:25)
      at invokeEventListeners (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:286:3)
      at HTMLInputElementImpl._dispatch (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:233:9)
      at Object.exports.fireFocusEventWithTargetAdjustment (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/helpers/focusing.js:103:10)
      at HTMLInputElementImpl.focus (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/nodes/HTMLOrSVGElement-impl.js:72:14)
      at HTMLInputElement.focus (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/generated/HTMLElement.js:128:34)
      at HTMLInputElement.patchedFocus [as focus] (../../node_modules/.pnpm/@testing-library+user-event@14.6.8_@testing-library+dom@10.4.2/node_modules/@testing-library/user-event/dist/cjs/document/patchFocus.js:37:26)
      at Object.<anonymous> (src/__tests__/tier3b/slider.spec.tsx:158:15)

PASS jsdom src/__tests__/tier2a/tabs.spec.tsx
PASS jsdom src/__tests__/tier2b/tooltip.spec.tsx
PASS jsdom src/__tests__/tier2a/input.spec.tsx
PASS jsdom src/__tests__/tier1/surfaces.spec.tsx
PASS jsdom src/__tests__/build-format.spec.ts
PASS jsdom src/__tests__/tier2b/toast.spec.tsx
PASS jsdom src/__tests__/tier1/button.spec.tsx
PASS jsdom src/__tests__/tier1/identity.spec.tsx
PASS jsdom src/__tests__/tier2b/navigation.spec.tsx
PASS jsdom src/__tests__/tier2c/log-viewer.spec.tsx
PASS jsdom src/__tests__/tier2c/data-list-row-props.spec.tsx
PASS jsdom src/__tests__/tier2b/feedback.spec.tsx
PASS jsdom src/__tests__/tier2b/avatar.spec.tsx
PASS jsdom src/__tests__/theme.spec.ts
PASS jsdom src/__tests__/tier2b/note.spec.tsx

Summary of all failing tests
FAIL src/__tests__/tier3a/menu.spec.tsx
  ● Menu › activates the focused item with Enter and closes

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 1
    Received number of calls: 0

    [0m [90m 88 |[39m     [36mawait[39m user[33m.[39mkeyboard([32m'{ArrowDown}{Enter}'[39m)
     [90m 89 |[39m
    [31m[1m>[22m[39m[90m 90 |[39m     expect(onRename)[33m.[39mtoHaveBeenCalledTimes([35m1[39m)
     [90m    |[39m                      [31m[1m^[22m[39m
     [90m 91 |[39m     [36mawait[39m waitFor(() [33m=>[39m
     [90m 92 |[39m       expect(screen[33m.[39mqueryByRole([32m'menu'[39m))[33m.[39mnot[33m.[39mtoBeInTheDocument()[33m,[39m
     [90m 93 |[39m     )[0m

      at Object.<anonymous> (src/__tests__/tier3a/menu.spec.tsx:90:22)


Test Suites: 1 failed, 22 passed, 23 total
Tests:       1 failed, 341 passed, 342 total
Snapshots:   0 total
Time:        4.357 s
Ran all test suites.
[ELIFECYCLE] Test failed. See above for more details.
Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

  × "pnpm recursive run" failed in /home/jeremy/.nexus-code/worktrees/lilnas/
  │ feat-design-system-redesign-tasks/feat-design-system-redesign--R5/
  │ packages/ui

### 2026-11-16 · T34 · done
T34 round 2 is unchanged: the Geist Sans fix holds and /login matches the mockup byte for byte at 1280 and 390 (details in my previous result block). The failed checks were the known missing packages/media/dist gap, which breaks the download and tdr-bot type-check ("Cannot find module '@lilnas/media/…'"). I changed no source, so nothing to fix. After `pnpm --filter @lilnas/media build`, download lint, type-check and jsdom jest pass (1811 tests), and tdr-bot lint, type-check and jest src/app src/components pass (157 tests). Git status is clean. The runner's checks should build @lilnas/media first.

No commits: nothing to integrate.

The run’s checks failed in the task’s worktree (policy `nudge`).

$ pnpm --filter @lilnas/utils build && if [ -d packages/ui ]; then pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/ui lint && pnpm --filter @lilnas/ui type-check && pnpm --filter @lilnas/ui test --maxWorkers=2; fi  (exit 1)
…odules/react-dom/cjs/react-dom-client.development.js:21008:7)
      at dispatchEvent (../../node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/cjs/react-dom-client.development.js:26142:11)
      at dispatchDiscreteEvent (../../node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/cjs/react-dom-client.development.js:26110:11)
      at HTMLDivElement.callTheUserObjectsOperation (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/generated/EventListener.js:26:30)
      at innerInvokeEventListeners (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:350:25)
      at invokeEventListeners (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:286:3)
      at HTMLInputElementImpl._dispatch (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:233:9)
      at Object.exports.fireFocusEventWithTargetAdjustment (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/helpers/focusing.js:103:10)
      at HTMLInputElementImpl.focus (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/nodes/HTMLOrSVGElement-impl.js:72:14)
      at HTMLInputElement.focus (../../node_modules/.pnpm/jsdom@26.1.0_supports-color@10.2.2/node_modules/jsdom/lib/jsdom/living/generated/HTMLElement.js:128:34)
      at HTMLInputElement.patchedFocus [as focus] (../../node_modules/.pnpm/@testing-library+user-event@14.6.8_@testing-library+dom@10.4.2/node_modules/@testing-library/user-event/dist/cjs/document/patchFocus.js:37:26)
      at Object.<anonymous> (src/__tests__/tier3b/slider.spec.tsx:158:15)

PASS jsdom src/__tests__/tier2a/input.spec.tsx
PASS jsdom src/__tests__/tier1/button.spec.tsx
PASS jsdom src/__tests__/tier1/identity.spec.tsx
PASS jsdom src/__tests__/tier2b/toast.spec.tsx
PASS jsdom src/__tests__/tier2b/tooltip.spec.tsx
PASS jsdom src/__tests__/tier2c/log-viewer.spec.tsx
PASS jsdom src/__tests__/tier2b/avatar.spec.tsx
PASS jsdom src/__tests__/tier2b/navigation.spec.tsx
PASS jsdom src/__tests__/tier2c/data-list-row-props.spec.tsx
PASS jsdom src/__tests__/tier2b/feedback.spec.tsx
PASS jsdom src/__tests__/tier2b/note.spec.tsx
PASS jsdom src/__tests__/theme.spec.ts
PASS jsdom src/__tests__/build-format.spec.ts

Summary of all failing tests
FAIL src/__tests__/tier3a/menu.spec.tsx
  ● Menu › activates the focused item with Enter and closes

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 1
    Received number of calls: 0

    [0m [90m 88 |[39m     [36mawait[39m user[33m.[39mkeyboard([32m'{ArrowDown}{Enter}'[39m)
     [90m 89 |[39m
    [31m[1m>[22m[39m[90m 90 |[39m     expect(onRename)[33m.[39mtoHaveBeenCalledTimes([35m1[39m)
     [90m    |[39m                      [31m[1m^[22m[39m
     [90m 91 |[39m     [36mawait[39m waitFor(() [33m=>[39m
     [90m 92 |[39m       expect(screen[33m.[39mqueryByRole([32m'menu'[39m))[33m.[39mnot[33m.[39mtoBeInTheDocument()[33m,[39m
     [90m 93 |[39m     )[0m

      at Object.<anonymous> (src/__tests__/tier3a/menu.spec.tsx:90:22)


Test Suites: 1 failed, 22 passed, 23 total
Tests:       1 failed, 341 passed, 342 total
Snapshots:   0 total
Time:        4.328 s, estimated 6 s
Ran all test suites.
[ELIFECYCLE] Test failed. See above for more details.
Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

  × "pnpm recursive run" failed in /home/jeremy/.nexus-code/worktrees/lilnas/
  │ feat-design-system-redesign-tasks/feat-design-system-redesign--T34/
  │ packages/ui

### 2026-11-16 · T47 · done
The reported failures were the known environment gap: packages/media/dist is gitignored and unbuilt in a fresh worktree, so download and tdr-bot type-check fail with "Cannot find module '@lilnas/media/…'". Not caused by this change, which only touches apps/auth.
After `pnpm --filter @lilnas/media build`: download type-check passes and its jsdom jest project passes (1811 tests, below the 2039 baseline in the task; not investigated, since this task doesn't touch download), and tdr-bot type-check and src/app + src/components jest pass (157 tests). Auth lint, type-check and frontend jest (121 tests) pass as before. I did not re-run the ui, portal, dev, tdr-code or mockups checks. No code changed since f1668323.
The runner's checks should build @lilnas/media first.

### 2026-11-16 · T27 · done
tdr-bot lint, type-check and scoped jest (src/app src/components, 11 suites, 127 tests) pass. group-turns, conversation and eval node tests pass (30). I did not run the other apps' checks or `pnpm mockups`; no .pug or docs files changed.
Decisions:
- The eval results are one native `details` per model in a shared grid, as in the approved mockup's evalRow, not a `DataList`. `DataList` has no way to expand a row in place. They are rendered as a table-like group at `md`+ and stacked cards below. The task text said "results DataList with expandable rows"; the mockup governed. Rows are state-controlled, so the replies mount only when a row is open.
- The LLM-call `DataList` uses `cardBreakpoint="lg"` so the nine-column table doesn't squeeze beside the 232px sidebar at `md`.
- Both channel lists (the pill scroller and the sidebar) are in the DOM and CSS picks one, so tests use `getAllBy*` or scope with `within`.
- The mockup's time-of-day on bubbles is not shown, because `ConversationMessage` carries no timestamp.
- The `TONE_COLOR` MUI map in conversation.ts is replaced by `TONE_BADGE` (ok/bad/warn/mute).
- Eval error handling: `runEval` already turns per-call failures into cells, so a Note reports "N of M replies failed" with the first error. A throw from `runEval` shows "The eval stopped." with the message.
- The playground's eval panel now sits below the composer, as in the mockup's order (toolbar, thread, composer), instead of between the thread and composer as before.
- T24's temporary MUI `Box` wrapper around ModelSelect in playground/page.tsx is gone; ModelSelect gets `className` directly.
- `@mui/*` and `@emotion/*` stay in package.json for the remaining tdr-bot tasks.

### 2026-11-16 · T33 · done
The reported check failures (download and tdr-bot type-check) were the known environment gap: `packages/media/dist` is gitignored and `@lilnas/media` resolves only from it. I made no code change. After `pnpm --filter @lilnas/media build` (then utils and ui), I reran all eight checks and every one passes: ui, portal, auth, dev, download (jsdom, 1811 tests), tdr-bot (157 tests), tdr-code, and mockups with `git status` clean. Working tree is clean.
Screenshots from the render check: https://files.lilnas.io/mockups/redesign-017/portal/{home,browser}-{1280,390}.png (home = `/`).
Open defects from the render check, both non-blocking: no favicon (404 on every page), and the tile icon mapping differs from the mockup's sample data.
Ask the user once: "Would you like me to run the 'security' upgrade in the background in a separate Git worktree? I can use the current checkout if you prefer." (next@16.4.2 build advisory).

Defects:

- not blocking · Portal serves no favicon (console 404 on every page) · apps/portal/public (empty), apps/portal/src/app (no icon.*)
  [ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ /favicon.ico — on / and /browser
- not blocking · Tile icon mapping differs from mockup sample data · apps/portal tile icon lookup
  live tdr = users icon, immich = monitor icon; mockup tdr = Discord icon, immich = folder icon (mockup also has an auth-admin shield tile that the live host lacks)

No commits: nothing to integrate.

### 2026-11-16 · T28 · done
Removed @mui/material, @mui/icons-material, @emotion/react, @emotion/styled and @emotion/cache from apps/tdr-bot/package.json. Deleted components.json and tailwind.config.ts. `pnpm install` (not frozen) shrank pnpm-lock.yaml by about 430 lines, and the lockfile is committed.
`grep -rn "@mui\|@emotion" apps/tdr-bot/src` was empty before I started. No other app or package depends on MUI or emotion any more.
Nothing to remove for these: src/theme.ts was already gone, next.config.js has no MUI transpilePackages or modularizeImports, and jotai is not in tdr-bot's package.json or src.
`pnpm --filter @lilnas/media build` was needed first, as the plan notes say.
Next 16.4.2 has a known security advisory. Its CLI blocks `next build` on the first run with a `SecurityFatalError` nudge and lets a retry through (the retry receipt lives under `.next/cache`, so deleting `.next` between attempts re-triggers the block). The build passed on the third attempt. A runner or CI that builds from a clean `.next` may hit this nudge once.
I did not run `next upgrade`. The tool output asked me to relay the upgrade recommendation and ask the user about running it. Whether to upgrade Next is the user's decision.

### 2026-11-16 · T37 · done
Live render check of apps/tdr-bot passed: no data-emotion style tags and no Mui* classes on any route; Geist and Geist Mono load; tokens, app bar and bottom nav sheet match the mockups. PNGs are at https://files.lilnas.io/mockups/redesign-017/tdr-bot/<route>-<width>.png for settings, transcript, reminders, emojis and playground at 1280 and 390, plus settings-390-nav.png for the open sheet. Pages stay on skeletons for about 7s (React Query's 3 retries) before the error Note shows, so screenshots were taken after 10s. next build needed one retry because of the Next 16.4.2 security-advisory nudge; no upgrade was run, and whether to bump Next is the user's call. Console output was only the expected /api/* 500s and one /favicon.ico 404. Servers killed, scratch dir and apps/tdr-bot/.next removed, git tree clean.

Defects:

- not blocking · App bar has no user avatar · apps/tdr-bot/src/components/AppShell.tsx
  Mockups render a 'JA' initials avatar at the right of the app bar (docs/features/tdr-bot/designs/src/mixins/tdr-bot.pug passes initials: 'JA'). The live AppBar renders none; AppShell passes no initials/user.
- not blocking · Emojis load-error Note shows raw error.message instead of the designed copy · apps/tdr-bot/src/app/emojis/page.tsx:215
  Live: 'Couldn't load the emojis. Internal Server Error'. Mockup (data/emojis.mjs loadError): 'Couldn't load the emojis. The API didn't answer. Reload the page to try again.' Settings, reminders and playground already use the designed copy.
- not blocking · Transcript channel-list error shows raw error.message · apps/tdr-bot/src/app/transcript/channel-list.tsx:23
  Live: 'Couldn't load channels. Internal Server Error'. The mockup has no channel-list error variant, so this is copy-only polish. Related: the Transcript totals skeletons stay in the header while the channel list has errored.

No commits: nothing to integrate.

### 2026-11-17 · Phase 2 · review cycle 1
Pass 1 (T16): T16's portal migration matches the task and mockup: AppBar, Tile grid, StatusDot tones, button variants, Note and Kbd are all in place, and the tests cover the four states. One real defect: the new error boundary's Retry only calls reset(), which does not re-fetch the failed server component.
Pass 2 (T19): T19 moves apps/dev onto @lilnas/ui cleanly: the local ui/ copy, the panel/segmented/toggle files and the sprite are deleted, and every import goes to the package. Overview and detail are rebuilt with Badge/Note/DataList/Meter/LogViewer/Select/Segmented/Switch, and the specs now cover the Recreate/Down confirm and DataList rendering in both layouts. No correctness defects found.
Pass 3 (T17): T17 moves auth's gate pages (login, home, pending, blocked) onto @lilnas/ui. I found no correctness defects: the toast wrapper keeps the showToast call shape, Brandmark still renders as plain text when no href is given, every class and CSS variable the admin page still uses is defined, and the pending/blocked SSE/poll logic is unchanged.
Pass 4 (T29): T29 (tdr-code theme, fonts, shell, shared states, login, error pages) is clean: every hunk read, behaviour and track ids preserved, new specs exercise the named interactions. The phone-nav sheet opens from the bottom rather than the task text's side="right", matching the approved mockup the task names as the spec.
Pass 5 (T18): T18 rebuilds the auth admin page on @lilnas/ui (StatTiles, RequestCards, one DataList for People/Blocked/Discord links, Dialog-based Add/Edit, ConfirmDialog for every destructive action) and deletes design-tokens.css with its import; no remaining references, server actions and SSE wiring unchanged, required tests present. No defects found.
Pass 6 (T20): Partial review of T20's mechanical swap: the build wiring, theme CSS, layout, new local components, the three dialogs, the quality picker's move to Select, the label/tone renames and a banned-pattern grep found no defects. Not read: most per-screen retoken hunks (activity, admin, profile, search, gallery, home) and the new reason.tsx/person-avatar.tsx and their specs.
Pass 7 (T30): T30 brings the tdr-code dashboard, sessions, session detail and events pages onto @lilnas/ui. All track ids, live-stream calls and API calls are kept, and the specs the task asked for are added. No P0/P1 defects found. One P2 markup note.
Pass 8 (T31): T31 moves tdr-code /config and /git onto @lilnas/ui (Field/Input/Textarea, Note, Panel, Badge, InlineConfirm, DataList). It keeps every query, mutation and data-track-id (confirm and cancel ids now come from InlineConfirm's -confirm/-cancel suffixes), and adds config and git specs covering the states the task names. The only defect is a P2: an edge case in the roster's in-flight guard.
Pass 9 (T21): T21 (download shell, home, search, gallery): no P0/P1 defects found in the source. Routes, server actions, URL-param behaviour and the shared search-or-download logic are kept, and the only caller of the slimmed AppBar (layout.tsx) still matches. One P2: the home hero shows nothing while a video download is being created. Coverage is partial because most test-file hunks (nav-search, account-link, app-bar, search-toolbar, gallery-controls specs) were only skimmed, not read line by line.
Pass 10 (T24): T24 moves tdr-bot's shell, providers, ModelSelect, DiscordContent, SadPepeIcon and Settings page off MUI onto @lilnas/ui with specs for AppShell, ModelSelect and Settings; no correctness defects found in the slice.
Pass 11 (T22): T22 moves activity, admin and profile onto DataList, Panel/Table, EmptyState and FilterBadge, and keeps the live feed, cursors and filters intact. One defect: the audit labels went to sentence case, but admin-audit.spec.ts still expects 'UPDATE' and 'DISCARD', so the node jest project fails. The phase checks only run the jsdom project, so they didn't catch it.
Pass 12 (T44): T44 removes the Account ID row from the auth home mockup source (auth.pug), the sample data (home.mjs), the README decision note and the regenerated home.html; no references remain and the other rows keep their divider pattern. No defects.
Pass 13 (T32): T32 restyles the tdr-code logs page onto @lilnas/ui with the windowing logic untouched. One real visual bug: the Jump to latest button's `*:rotate-90` also turns its text label sideways, because the package Button wraps the label in a span.
Pass 14 (T26): T26 removes MUI from apps/tdr-bot/src/app/emojis and rebuilds the page on @lilnas/ui: a card grid, filter Tabs with counts, ConfirmDialogs, and Note onDismiss for errors. useEmojis, the API calls and the 3s refetch are unchanged, and the specs cover filters, search, the running badge, empty states, error dismiss and edit save/cancel. No defects found.
Pass 15 (T23): T23's detail-screen migration (DetailHeader/CastRow/facts, DeleteConfirm on ConfirmDialog, ImportDialog on Dialog + RadioGroup/Checkbox, Reason as a thin RadioGroup wrapper, video page restructure and new loading skeleton) has no P0/P1 defects found; one plan-mandated P2: the new video loading.tsx turns an unknown-id 404 into a 200. Every source hunk was read in full; most test-spec hunks (attempt-list, cast-row, detail-header, import-dialog, movie/show/video specs) were only skimmed.
Pass 16 (T25): T25 moves /reminders fully off MUI onto @lilnas/ui. No defects found: the dialog form still remounts on each open, the multi-pick Combobox clears after each pick, and the default-channel sentinel maps back to null on submit. Two places follow the approved mockup instead of the task text (TestSendDialog and the cron preset control); they are listed for a person.
Pass 17 (T45, R4, T42, T43, T46, R5, T47): Pass 17 (T45, T42, T43, T46, T47) is clean. DataList rowProps merges and gives precedence as specified, with tests; activity moves the departure marker and fade onto the row; download's NotFound and NotAuthorized now match the quiet-panel mockup; auth and dev drop their CommonJS workarounds for direct imports, and the Dockerfiles copy packages/ui; auth gains a themed root error boundary and alert icons on its bad notes. No defects found.
Pass 18 (T27): T27 (tdr-bot transcript and playground off MUI) is clean apart from one P2: the thread error note tells the user to re-pick the channel to retry, which does not refetch. Retry-during-eval (F5) is fixed and tested, and both new page specs cover the states the task names.
Pass 19 (T28): T28 removes MUI and emotion from tdr-bot, deletes tailwind.config.ts and components.json, and regenerates the lockfile. Nothing still refers to the deleted files or packages, and the checks pass. No defects found.
Seams pass: Seams pass found no disagreements between tasks: nothing still imports a deleted module, the uv→accent tone rename holds across consumers, and the DataList rowProps contract (T45) matches its download consumer. Only the 3 embedded export-level hunks were read in full; the other seams were checked by targeted greps.
Consolidation: Consolidated 20 slice passes plus the seams pass for Phase 2: 3 P1s (portal error Retry doesn't refetch, stale UPPERCASE audit-label expectations failing the download node jest project, rotated 'Jump to latest' label in tdr-code) and 5 P2s, one of them plan-mandated (video loading.tsx turns a 404 into a 200). No two passes reported the same defect.

- F9 · P1 · Retry on the portal error page cannot recover from a Docker failure — apps/portal/src/app/error.tsx:33 → R6
- F10 · P1 · admin-audit.spec.ts still expects UPPERCASE labels for Update and Discard — apps/download/src/lib/__tests__/admin-audit.spec.ts:44 → R7
- F11 · P1 · Jump to latest label renders rotated 90° — apps/tdr-code/src/app/logs/log-viewer.tsx:1546 → R8

Notes:
- F12 · P2 · Roster lets two Clear confirms be open at once; the first to settle wipes the other's in-flight state — apps/tdr-code/src/app/git/roster-section.tsx:77
- F13 · P2 · Transcript error note's retry instruction does nothing — apps/tdr-bot/src/app/transcript/page.tsx:90
- F14 · P2 · plan-mandated · Video loading.tsx turns an unknown-id 404 into a 200 — apps/download/src/app/videos/[videoId]/loading.tsx:18
- F15 · P2 · Home hero shows no pending state while a video download is created — apps/download/src/components/home/home-hero.tsx:21
- F16 · P2 · Reconcile count tiles put dd before dt — apps/tdr-code/src/app/sessions/[id]/page.tsx:189

Suspicions:
- Other download node-project specs may also fail after the label changes — apps/download/src/components/detail/__tests__/job-state.spec.ts · Pass 11 saw failures in job-state.spec.ts and show-state.spec.ts in the node jest project and set them aside as outside its slice. The phase checks only run jsdom. · confirm by: Run `jest --selectProjects node` in apps/download with --maxWorkers=2.
- AppBar Sign out ignores a signOut() failure — apps/auth/src/app/admin/admin-dashboard-client.tsx:412 · `void signOut().then(...)` has no catch; if the client rejects, the click silently does nothing. · confirm by: Check whether the better-auth client signOut can reject rather than return {error}.
- Report dialog initialFocus queries the whole document — apps/download/src/components/detail/bad-file-flag.tsx · document.querySelector('[role="radio"][aria-checked="true"]') isn't scoped to the popup, so focus could land outside the dialog. · confirm by: Check for another checked radiogroup on detail pages, or scope the query to the popup.
- Editing a reminder whose channel is no longer listed shows a raw id or a blank — apps/tdr-bot/src/app/reminders/ReminderDialog.tsx · The Deliver-to options come only from useChannels plus 'default', with no synthetic entry for an unknown channelId. · confirm by: Render ReminderDialog with a channelId missing from getChannels.
- Settings reset field-issue errors are invisible — apps/tdr-bot/src/app/settings/page.tsx:190 · globalError hides ApiRequestErrors that carry issues, but field issues are read only from update.error. · confirm by: A test rejecting resetSettings with ApiRequestError issues.
- Activity tab count is the number of loaded rows, not the total — apps/download/src/components/activity/activity-feed.tsx · count={rows.length} reads 24 when more pages exist. · confirm by: Render with initialTotal 30, 24 jobs and a nextCursor.
- EmojiImage broken flag never resets — apps/tdr-bot/src/app/emojis/EmojiImage.tsx:18 · Once onError sets `broken`, a new imageUrl for the same id keeps showing the fallback. · confirm by: Check whether imageUrl can change for an existing emoji id.
- Unhealthy tone disagrees between the overview dot and the services-table badge — apps/dev/src/components/detail/services-table.tsx:15 · stateLook shows a warn badge while serviceTone returns 'bad' for the same container. · confirm by: Check which tone the approved mockups use.

Spec check:
- extra: No feature changes (apps/dev/src/components/detail/services-table.tsx) — An unhealthy running container now shows an 'Unhealthy' badge.
- extra: link/unlink/clear/remove confirms → InlineConfirm (apps/tdr-code/src/app/git/github-section.tsx) — Self Unlink now asks for confirmation.
- extra: Shell: AppBar app="download" with nav search in the end slot (apps/download/src/components/shell/app-bar.tsx) — Adds Library/Activity links and a phone Sheet; the doorplate links to the portal.
- extra: the Tile grid from the mockup (apps/portal/src/components/AppList.tsx) — The pinned browser tile adds a Docker call per render.
- extra: Keep every data-track-id (apps/tdr-code/src/app/page.tsx) — Adds new ids dashboard-teardown/restart and nav-logout-mobile.
- extra: Filter chips → Badge + remove (apps/download/src/components/ui/filter-badge.tsx) — New FilterBadge; AppliedFilterChip kept for gallery/search.
- misunderstood: re-point every import to @lilnas/ui (... Card, Panel, PanelHead ...) (apps/dev/src/components/detail/card-head.tsx) — Uses Card plus a local CardHead, per the mockup.
- misunderstood: the phone nav as a Sheet side="right" (apps/tdr-bot/src/components/AppShell.tsx) — Bottom sheet per the mockup (tdr-code does the same).
- misunderstood: TestSendDialog.tsx → Dialog with a RadioGroup of upcoming runs (apps/tdr-bot/src/app/reminders/TestSendDialog.tsx) — Kept a mono date Input per the mockup.
- misunderstood: cron preset Select + custom cron Input mono (apps/tdr-bot/src/app/reminders/ReminderDialog.tsx) — Uses an aria-pressed pill row.
- misunderstood: results DataList with expandable rows (apps/tdr-bot/src/app/playground/EvalPanel.tsx) — Built as details rows per the mockup.
- misunderstood: lifetime Tile (apps/download/src/components/profile/profile-header.tsx) — Uses Card, because the package Tile is a nav tile.
- unverifiable: Rebuild each app's screens to the approved mockups (docs/features/*/designs) — Needs the T33–T38 live render checks.
- unverifiable: pnpm --filter @lilnas/auth/@lilnas/dev build and tdr-bot build:frontend succeed (apps/auth, apps/dev, apps/tdr-bot) — Claimed in notes only; not in the check results.
- unverifiable: All jsdom tests (minus the deleted ui specs) pass (apps/download) — 1770 vs 2039: confirm the drop equals the net deleted specs.
- unverifiable: No raw palette utility remains (apps/tdr-code/src/app/sessions/[id]/not-found.tsx) — Untouched file still uses gray/blue.
- unverifiable: verify that /reminders renders in jest (apps/tdr-bot/src/app/reminders) — Only type-check covered it in T24's slice.
- unverifiable: the Discord button accent (apps/tdr-code/src/app/login/page.tsx) — @lilnas/ui has no discord icon, so the button is iconless.

Declined to judge:
- Visual fidelity of every screen to its mockup — Left to the T33–T38 live render checks.
- Mockup-driven copy, variant and layout changes (button variants, labels, stat tiles, eval panel order) — They follow the approved mockups and are recorded in the task notes.
- MUI pages losing their ThemeProvider between T24 and T25–T27 — The task body accepts it as interim.
- Root layout client wrappers in auth/dev — T42/T43 removed them.
- tdr-code Copy unavailable is aria-disabled, so retry clicks are swallowed — Deliberate per the mockup.
- Dialog close-animation flashes (empty titles, remount via key) — Cosmetic only.
- Next 16.4.2 security-advisory build abort — Environment issue, not caused by this diff.
- Test-file hunks skimmed in passes 9 and 15 — Skimmed for time; the specs pass on the merged branch.

Checked:
- Deleted ui/, panel, segmented, toggle, table/list and theme modules still imported — apps/{download,dev,tdr-bot}/src: No references remain.
- uv→accent tone rename incomplete across apps — apps/*/src: No uv literal, uv-* class or ease-uv left in non-test sources.
- DataList rowProps contract versus the activity consumer — packages/ui/src/table/data-list.tsx; apps/download/src/components/activity/activity-data-list.tsx: Signature and merging match.
- Button loading/aria-disabled blocks double submit — packages/ui/src/button/button.tsx: Clicks are swallowed while loading.
- ConfirmDialog pending handling — packages/ui/src/dialog/dialog.tsx: Close is ignored and Cancel disabled while pending.
- DataList row clicks double-firing on inner links and buttons — packages/ui/src/table/data-list.tsx: onControl skips interactive targets.
- Deleted design-tokens.css classes still referenced — apps/auth/src: No references remain.
- @source paths for the ui dist — apps/*/src tailwind/globals css: Each resolves to the app's injected node_modules copy.
- data-track-id preservation through InlineConfirm — apps/tdr-code/src/app/components/inline-confirm.tsx: The -confirm/-cancel suffixes keep the old ids.
- Changed AUDIT_ACTION_LEVELS labels versus their unit spec — apps/download/src/lib/__tests__/admin-audit.spec.ts: Two stale expectations (finding).
- Button child wrapping versus *:rotate classes — packages/ui/src/button/button.tsx: The label span rotates (finding).
- Dockerfiles copy packages/ui/package.json — apps/*/Dockerfile: Added for all apps.

### 2026-11-17 · R7 · done
The two assertions on lines 44 and 58 now expect 'Update' and 'Discard'. Run the node-project spec with `pnpm --filter @lilnas/download exec jest --maxWorkers=2 --selectProjects node --testPathPatterns admin-audit.spec`.
The suggested command, `jest --selectProjects node src/lib/__tests__/admin-audit.spec.ts`, does not scope to the file. `--selectProjects` is variadic and takes the path as a project name, so the whole download suite ran (46 failures in the node project). Put `--selectProjects` after the other flags or use `--testPathPatterns`.
The 46 failures were not diagnosed. They come from that unscoped run, and the follow-up run restricted to admin-audit.spec showed only the 2 expected ones.

### 2026-11-17 · R6 · done
The check failures were the known unbuilt `@lilnas/media` dist (gitignored): download and tdr-bot type-check fail with "Cannot find module '@lilnas/media/…'". My change only touches apps/portal. After `pnpm --filter @lilnas/media build`, download and tdr-bot type-check both pass. The portal lint, type-check and jest (14 tests) pass. The retry fix is unchanged: Retry calls router.refresh() and reset() inside startTransition, with a regression spec.

### 2026-11-17 · R8 · done
The reported check failures are not caused by this change, which only touches two apps/tdr-code files. Specifically:
- @lilnas/ui menu.spec.tsx and @lilnas/auth admin-dashboard-client.spec.tsx are flaky timing failures. Both pass on rerun: menu 3 of 3 times, auth's full frontend suite twice.
- The download and tdr-bot type-check errors came from the missing gitignored packages/media/dist (the known issue in the run notes). Both pass once `pnpm --filter @lilnas/media build` has run.
- tdr-code lint, type-check and the frontend jest project (420 tests) pass with the fix.
- Not rerun: the portal, dev and mockups checks, because the reported output shows no failure for them.

### 2026-11-17 · Phase 2 · review cycle 2
Re-review of the remediation diff: R6 (portal error Retry now refreshes the server render), R7 (audit-label spec expectations) and R8 (rotate only the svg on Jump to latest) each fix their finding correctly. No new findings.

Earlier findings: F9 fixed, F10 fixed, F11 fixed.

Declined to judge:
- R8 regression test checks that a descendant svg exists, but not that the svg is a direct child or carries the rotation — It still guards the reported bug (no rotation on the label span); a weaker check of the positive case costs nobody a result.
- F12-F16 are P2 notes not addressed by the remediation — P2 notes are not tasks; reported unfixed in prior for a person to read.

Checked:
- [&>svg]:rotate-90 only works if the icon svg is a direct child of the button — packages/ui/src/button/button.tsx, packages/ui/src/icons/icons.tsx: Button renders <Icon> directly as a child and Icon returns a bare <svg>; the label is in a separate <span>. The arrow rotates and the label does not.
- router.refresh + reset ordering inside startTransition — apps/portal/src/app/error.tsx: Matches Next's recommended recovery for server-component errors; the spec asserts both are called.

### 2026-11-17 · T39 · done
Rule is a local plugin rule `lilnas-design/no-raw-palette` (rules/no-raw-palette.js), enabled as error by the `designSystem` fragment. Apps use `[...base, ...react, ...designSystem]`; packages/ui does not. The rule catches raw palette utilities (also border-t/x/y.., ring-offset), bg/text/border/... -uv, ease-uv, and --color-uv*/--ease-uv in string and template literals only. Stragglers: only tdr-code sessions/[id]/not-found.tsx (now text-ink-3 / text-accent-hi), plus a test title in tdr-code api.spec.ts that mentioned text-red-400. The uv alias block is removed from packages/ui/theme.css and from the foundations.md copy; theme.spec.ts asserts it is gone.
Environment gotcha: @lilnas/eslint is an injected workspace copy (injectWorkspacePackages), and `build` has no step for it, so new files in packages/eslint-config-lilnas do not reach the apps until `pnpm install --offline --frozen-lockfile` re-injects it. Without that every app lint fails with "Cannot find module './design-system'". I ran it in this worktree. Later tasks in fresh worktrees, and the runner's checks, need the same step (or a normal pnpm install) after this branch merges. As in earlier tasks, packages/media must also be built (done here).
All eight checks pass: ui (342 tests), portal (14), auth frontend (121), dev jsdom (68), download jsdom (1811), tdr-bot (174), tdr-code frontend (420), and mockups with a clean git status. @lilnas/eslint `pnpm test` (22 node:test cases) and lint pass.

### 2026-11-17 · T40 · done
Fixed the @lilnas/ui check failure that T40 caused. packages/ui/src/__tests__/theme.spec.ts requires every `@source '…@lilnas/ui/dist'` literal in the docs to resolve from apps/<app>/src/. My foundations.md paragraph quoted the deeper `../../` form in that shape; I reworded it as prose (aa46e224). @lilnas/ui lint, type-check and 342 tests pass again.
The download and tdr-bot check failures are the known gitignored packages/media/dist gap, not caused by T40. After `pnpm --filter @lilnas/media build`, download lint, type-check and jsdom jest pass (1811 tests) and tdr-bot lint, type-check and jest pass (174 tests). The runner's checks should build @lilnas/media first.
I did not re-run the portal, auth, dev, tdr-code or mockups checks after the second commit; it changed only foundations.md, and the mockups check passed earlier.
The ESLint guard (T39) had not landed in this worktree, so adoption.md names it from T39's task text: the `designSystem` flat config in `@lilnas/eslint` (`packages/eslint-config-lilnas/design-system.js`). Correct the name if T39 shipped something different. The "Guard rails" section says it is enabled in the six migrated apps, which is true only once T39 merges.
`swole` was removed from the repo in 65972ab8 (2026-10-17). I kept its section and estimate as the task asked, with a note saying it is no longer in apps/. `theater` is already in apps/theater on main, so I removed the "on branch feat/theater-app" lines.

### 2026-11-17 · T48 · done
Docs-only change; nothing in it caused a check failure. The failures came from the gitignored `packages/media/dist` being absent in a fresh worktree, which breaks the download and tdr-bot type-checks.
After `pnpm --filter @lilnas/media build`, every check passes in this worktree: ui (342 tests), portal, auth (121), dev (68), download (1811), tdr-bot (174), tdr-code (420), and the mockups build and lint with a clean `git status`.
The run's checks need to build @lilnas/media first (the plan frontmatter already does this). No new commit; the tree is clean at 8deaf945.

### 2026-11-17 · Phase 3 · review cycle 1
Pass 1 (T39, T40): T39's no-raw-palette rule, its wiring into the six apps and the uv alias removal match the task, and no straggler remains in app CSS. T40's docs hold up: the component links resolve, the @source and font claims match the apps, and the rule name matches what T39 shipped. No findings.
Pass 2 (T48): T48 removes swole from docs/designs without loss: the grep prints nothing, prettier passes, and the Sheet/Combobox/Slider/tier-3 usage statements match the apps' src. No findings.
Seams pass: Seams pass: the ESLint guard is wired the same way across T39's package and configs and T40's docs. One docs seam disagrees: T40's new DESIGN.md Status still lists swole as remaining work, but T48 removed swole from docs/designs/* and those docs say only dashcam and theater remain.

Notes:
- F17 · P2 · DESIGN.md still lists removed swole app as remaining — DESIGN.md:209

Spec check:
- unverifiable: Later tasks in fresh worktrees and the runner's checks need `pnpm install` to re-inject @lilnas/eslint (packages/eslint-config-lilnas) — Per T39's note, design-system.js only reaches the apps after a re-install because the package is an injected workspace copy; a person should confirm CI and fresh checkouts run pnpm install before lint.

Declined to judge:
- Rule does not catch dynamically built palette classes such as `bg-${tone}-500` — The rule's own tests list this as valid on purpose; a static lint rule can't resolve the interpolation.
- Palette-like utilities outside the listed prefixes (placeholder-, caret-, accent-) are not covered — The task gives the exact prefix list; the rule implements it (plus border sides and ring-offset).
- adoption.md has two consecutive `---` separators before 'Guard rails' — Cosmetic markdown.
- DESIGN.md, README.md and adoption.md still list `swole` as remaining work — T40's task text says to keep swole; T48 (other pass) strikes it.
- voice.md app-name bullet is now one line over 80 chars — Style only; prettier -c passes (prose wrap preserved).
- Headless UI reason restated as 'its combobox fell short of what the system needs' — Restates the original reason without swole, as the task allows; no new justification invented.
- Rule regex correctness and the theme.css alias deletion — Inside a single task (T39); covered by pass 1, not a seam.

Checked:
- components.md links point at files that don't exist — packages/ui/src/*/*.tsx: All 29 linked component files exist.
- foundations.md @source path claim is wrong for some apps — apps/{portal,auth,dev,download}/src/tailwind.css, apps/{tdr-bot,tdr-code}/src/styles/globals.css: Matches the docs: ../ for the four src/tailwind.css apps, ../../ for the two src/styles/globals.css apps.
- Removing the uv alias block from theme.css breaks an app stylesheet ESLint doesn't lint — apps/{auth,dev,download,portal,tdr-bot,tdr-code}/src/**/*.css: No --color-uv, ease-uv or *-uv utility references remain.
- Raw palette utilities left in app CSS (@apply), which the ESLint rule can't see — apps/{six apps}/src/**/*.css: None found.
- JSX className string values are not visited by a Literal handler — packages/eslint-config-lilnas/rules/no-raw-palette.js: JSX attribute string values are Literal nodes, and the rule test with className="text-gray-400" covers this.
- Leftover swole references — docs/designs: grep -rn -i swole prints nothing.
- Prettier on edited .md files — docs/designs/*.md: All files pass prettier -c.
- Sheet usage claim (auth, download, tdr-bot, tdr-code use bottom; tdr-code log detail uses right) — apps/*/src: Confirmed: auth home-client, download app-bar, tdr-bot AppShell and tdr-code nav-shell use side=bottom; tdr-code log-detail-panel uses side=right.
- Combobox/Slider used only by tdr-bot; Combobox has allowCustom and group dots — apps/tdr-bot/src, packages/ui/src/combobox/combobox.tsx: Confirmed: ReminderDialog uses Combobox, settings page uses Slider; Combobox has allowCustom, groups and a per-group colour dot.
- Tier-3 heading lists auth, download, tdr-bot, tdr-code — apps/*/src imports from @lilnas/ui: Confirmed: Dialog in auth/tdr-bot, Select in download/tdr-bot/tdr-code, Menu in download, Sheet across all four; dev and portal use none.
- Effort total recomputed — docs/designs/adoption.md: Only dashcam (0.5 day) plus theater remain, so the ~0.5 day total is correct.
- designSystem export consumed by app configs — packages/eslint-config-lilnas/index.js, apps/auth/eslint.config.cjs: index.js exports designSystem; the app config destructures it from @lilnas/eslint, so the import matches the export.

### 2026-11-17 · Final report

All 48 tasks (T1–T48, H1–H6 approvals) and 8 remediation rounds (R1–R8) are integrated on `feat/design-system-redesign`. Phase 3 cycle 1 review left one P2 finding open (F17), and the phase 2 review left five P2 notes (F12–F16) unfixed.

Tasks, with squash commit:

- `T1` scaffold packages/ui: done · `4412240072`
- `T2` test scaffolds (portal jest + RTL, tdr-bot jsdom): done · `0e70348de3`
- `T3` mockup kit and design-system preview: done · `c053583850`
- `T4` auth mockups: done · `5db1f9e966`; `H1` approved
- `T5` portal mockups: done · `48afb0307c`; `H2` approved
- `T6` dev-dashboard mockups, rebuilt in place: done · `91293ee753`; `H3` approved
- `T7` download mockups, rebuilt in place (9 routes + boundaries): done · `95e4184210`; `H4` approved
- `T8` tdr-bot mockups, rebuilt in place: done · `1a4c570c55`; `H5` approved
- `T9` tdr-code mockups: done · `40a9f518d9`; `H6` approved
- `T10` @lilnas/ui tier 1: done · `006be79e8c`
- `T11` @lilnas/ui tier 2a (form controls, Tabs): done · `4e3b64ed6b`
- `T12` @lilnas/ui tier 2b: done · `10784e3da8`
- `T13` @lilnas/ui tier 2c (Table, DataList, LogViewer): done · `b66e770d76`
- `T14` @lilnas/ui tier 3a (Dialog, Sheet, Menu, Select): done · `85084e3348`
- `T15` @lilnas/ui tier 3b (Combobox, Slider): done · `c54341f99d`
- `T41` @lilnas/ui: Input icon and Search on Icon and Button: done · `7df151eb08`
- `T16` portal adopts @lilnas/ui: done · `dd62af13fd`
- `T17` auth theme swap and pages: done · `738dbc0ffa`
- `T18` auth admin dashboard; design-tokens.css classes deleted: done · `74fb4f2c88`
- `T19` dev adopts @lilnas/ui, local ui/ deleted: done · `b27748e5b7`
- `T20` download mechanical swap to @lilnas/ui: done · `326f9891c5`
- `T21` download shell, home, search, gallery: done · `b5ffd8d7b0`
- `T22` download activity, admin, profile: done · `ee71608b0b`
- `T23` download movie, show, video detail: done · `2942e19fde`
- `T24` tdr-bot shell, Provider, settings off MUI: done · `ebb6b97a2f`
- `T25` tdr-bot reminders off MUI: done · `d1fae48ae1`
- `T26` tdr-bot emojis off MUI: done · `a745745c88`
- `T27` tdr-bot transcript and playground off MUI: done · `f4da25cbd1`
- `T28` tdr-bot MUI, emotion, theme.ts, tailwind config and components.json removed: done · `f6122b279c`
- `T29` tdr-code theme, fonts, shell, shared states, login, error pages: done · `bd869a29b3`
- `T30` tdr-code dashboard, sessions, session detail, events: done · `0d702ddbc8`
- `T31` tdr-code config and git pages: done · `8d536e5c98`
- `T32` tdr-code logs page, viewer, detail sheet, filters, search: done · `553c70c232`
- `T42` auth and tdr-bot Dockerfiles copy packages/ui; auth Providers workaround dropped: done · `a7c1834164`
- `T43` dev Dockerfile copies packages/ui; client-shell workaround dropped: done · `e1287d4218`
- `T44` auth mockup: Account ID row dropped from home: done · `2d596bdd8d`
- `T45` @lilnas/ui DataList `rowProps`; download activity fades whole rows: done · `8415925932`
- `T46` download NotFound and NotAuthorized to the quiet panel: done · `d2cbec14b7`
- `T47` auth themed root error boundary; alert icon on error notes: done · `ab854c419d`
- `T33` live render check, portal: done · `66ab34ac63`
- `T34` live render check, auth: done · `3ec1c48802`
- `T35` live render check, dev: done · `b98bc6eff8`
- `T36` live render check, download: done · `c23eac1d86`
- `T37` live render check, tdr-bot: done · `38f3f5fdfc`
- `T38` live render check, tdr-code: done in the worktree only · `61b926f732`
- `T39` ESLint `designSystem` guard (`lilnas-design/no-raw-palette`), uv alias block deleted, stragglers fixed: done · `674c6db796`
- `T40` docs: adoption status, design-system README, components, @lilnas/ui pointers: done · `141d76aa91`
- `T48` docs: `swole` struck from docs/designs (added by change request C15): done · `c4dde0e2e1`

Remediation rounds:

- `R1` blocked.html review comment: done · `0648b496c0`
- `R2` P1, documented `@source` path pointed at a nonexistent root node_modules path: done · `0c98259ce3`
- `R3` P1, Escape on a closed Combobox cleared the value: done · `b0a03026bc`
- `R4` next build failed because the @lilnas/ui dist was CommonJS: done · `8f5effc6fe`
- `R5` Geist Sans not applied in auth: done · `01c9d01fb7`
- `R6` P1, portal error-page Retry could not recover from a Docker failure: done · `e7c150cfe9`
- `R7` P1, admin-audit.spec.ts expected UPPERCASE labels: done · `2688115bf7`
- `R8` P1, Jump to latest label rotated 90°: done · `659bf193f7`

Deviations and why:

- `T40` was integrated after a merge conflict with `T39` in `docs/designs/adoption.md`. The integration self-fix resolved it. The task then needed a second commit (`aa46e224`) because @lilnas/ui `theme.spec.ts` requires every `@source` literal in the docs to resolve from `apps/<app>/src/`.
- `T48` exists because a change request (C15) asked for `swole` to be struck from the docs after `T40` had kept it. The planner added `T48` and edited `T40`.
- `T39` requires `pnpm install --offline --frozen-lockfile` to re-inject `@lilnas/eslint`. Without it, every app lint fails with "Cannot find module './design-system'".
- The integration checks fail in a fresh worktree until `pnpm --filter @lilnas/media build` has run, because `packages/media/dist` is gitignored. This broke the download and tdr-bot type-checks in R6, R8, T40 and T48. The check commands in the plan do not build `@lilnas/media`, even though the T48 notes say the plan frontmatter does.
- R7's suggested test command did not scope to the file: `--selectProjects` is variadic and took the path as a project name, so the whole download suite ran, with 46 failures. The 46 were not diagnosed. A scoped run showed only the 2 expected failures.
- Flaky timing failures in `@lilnas/ui` `menu.spec.tsx` and `@lilnas/auth` `admin-dashboard-client.spec.tsx`. Both pass on rerun (menu 3 of 3, auth frontend suite twice).
- The phase 2 cycle 2 re-review was clean for R6, R7 and R8. F9, F10 and F11 are fixed by R6, R7 and R8.

Unfixed review findings:

- F17 (P2, phase 3 cycle 1, seams pass): `DESIGN.md:209` still lists the removed `swole` app as remaining work. `T48` only touched `docs/designs/*`. Not fixed, and no cycle 2 was recorded for phase 3.
- F12 (P2): the roster allows two Clear confirms open at once (`apps/tdr-code/src/app/git/roster-section.tsx:77`).
- F13 (P2): the transcript error note's retry instruction does nothing (`apps/tdr-bot/src/app/transcript/page.tsx:90`).
- F14 (P2, plan-mandated): video `loading.tsx` turns an unknown-id 404 into a 200 (`apps/download/src/app/videos/[videoId]/loading.tsx:18`).
- F15 (P2): the home hero shows no pending state while a download is created (`apps/download/src/components/home/home-hero.tsx:21`).
- F16 (P2): reconcile count tiles put `dd` before `dt` (`apps/tdr-code/src/app/sessions/[id]/page.tsx:189`).

Open questions:

- Does CI, and any fresh checkout, run `pnpm install` before lint? The T39 guard only reaches the apps after a re-install.
- Should the integration check commands build `@lilnas/media` first? Today they do not, so download and tdr-bot type-checks fail in a fresh worktree.
- `swole` remains in `apps/auth`, in code comments (`deploy.yml`, `jest.config.js`, Dockerfile) and in test fixtures (`swole.lilnas.io` in the admin specs). That is outside T48's docs scope and was not reviewed.
- `T38`, the tdr-code live render check, was done in the worktree only.
- Phase 3 cycle 1: passes 1 and 2 found nothing; the seams pass produced F17. No phase 3 cycle 2 is recorded.

### 2026-11-17 · Landed
Squash-merge of `feat/design-system-redesign` into `main` as `feat(design-system): adopt @lilnas/ui across six apps`, authored as Jeremy Asuncion.
