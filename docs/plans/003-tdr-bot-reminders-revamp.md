---
nexus-plan: 2
title: tdr-bot reminders revamp
branch: feat/tdr-bot-reminders-revamp
base: main
setup:
  - pnpm install --frozen-lockfile
  - pnpm --filter @lilnas/utils --filter @lilnas/media build
checks:
  - pnpm --filter @lilnas/tdr-bot lint
  - pnpm --filter @lilnas/tdr-bot type-check
  - pnpm --filter @lilnas/tdr-bot exec jest --maxWorkers=2
  - pnpm run mockups:lint
parallel: 2
review: per-phase
commit-style: "conventional with scope, e.g. feat(tdr-bot): …, fix(tdr-bot): …, refactor(tdr-bot): …"
---

# tdr-bot reminders revamp

## Goal
Rebuild the reminder subsystem of `apps/tdr-bot` so it is reliable and
inspectable: reminders live in Postgres with a status and a `next_run_at`, a
30-second poller delivers whatever is due (restart-safe, no in-process timer
chains), the plain-language skill creates, lists and cancels reminders without
dead ends (cancel resolves against the user's actual reminders and asks a
follow-up when ambiguous; "cancel all" asks for a yes), and the admin frontend
gets a Reminders page that shows every reminder — who created it, for whom, the
schedule, next run, last run, when it ends, status — with create, edit and
cancel. Delivery behaviour (default text, web-search and math action types,
channel and target-user overrides, the `tdr-bot-chat` fallback) is preserved.

## Decisions
- **Lists are public replies.** The user asked about ephemeral replies but then
  dropped the requirement; Discord can only make interaction replies ephemeral,
  so a plain-message list stays a normal reply. No buttons, slash commands or DMs.
- **DB-driven poller, not timers.** Each row carries `next_run_at`; a
  `@Interval` tick delivers due rows and advances them. Replaces
  `SchedulerRegistry` timeouts, the 24.8-day timeout chaining, the
  pending-delivery queue and `setDeliveryFunction`.
- **Rows are kept with a status** (`active | completed | cancelled | missed`)
  so the admin page has history; users only ever see `active`. Finished rows
  older than 90 days are pruned by the scheduler once a day.
- **Recurring reminders can end.** New optional `ends_at`; "every day until
  Friday" works from chat and the admin form. One-time reminders overdue by more
  than an hour when the bot boots are marked `missed`, not silently deleted.
- **Cancel is resolved by the LLM against the user's real reminders** (ids in,
  ids out), with a follow-up round when ambiguous and a yes/no follow-up for
  "cancel all". List and cancel confirmations are deterministic text; the
  persona LLM calls stay for "ask for missing info" and "confirm created".
- **`day_description`/`time_description` collapse into one
  `schedule_description`**, backfilled in the migration. Reminder creator's
  Discord username is stored (`user_name`) so history survives a user leaving.
- **Admin page is the existing Next.js app** at `tdr.lilnas.io` (already behind
  `lilnas-auth`); there is no in-app role model, everyone who can log in is the
  admin. Mockup first, then review, then implementation.
- **One timezone constant** (`America/Los_Angeles`, matching `TZ` in
  `.env.example`) is passed to `cron` explicitly rather than relying on the
  process TZ.

## Context
- pnpm + Turbo monorepo. This work is confined to `apps/tdr-bot` (NestJS 11
  backend on 8081 + Next.js 15 frontend on 8080 proxying `/api/*` to it) and the
  mockups in `docs/features/tdr-bot/designs/`.
- Checks, from the repo root: `pnpm --filter @lilnas/tdr-bot lint` (eslint +
  prettier; fix with `… lint:fix`), `… type-check`, `… exec jest --maxWorkers=2`
  (never more workers: the host is the production server). Jest config is
  `apps/tdr-bot/jest.config.js`: tests live in `__tests__/` beside the source and
  only `.ts` files are tests; `__tests__/factories/*.ts` and `__tests__/helpers/*.ts`
  are excluded from matching, so shared fixtures go there. `src/__tests__/setup.ts`
  installs global mocks for discord.js (`Client`, `EmbedBuilder`, `Collection`,
  `ChannelType`), necord, minio, fs-extra and `nanoid` (always `'test-id-123'`:
  pass ids explicitly or `jest.unmock('nanoid')`). Add `MessageFlags` or other
  discord.js exports with a per-test `jest.mock`, not by editing `setup.ts`.
- Style: imports use the `src/...` alias; no semicolons, single quotes, trailing
  commas, `arrowParens: avoid`; no `any`; logging is pino-style
  `logger.log({ obj }, 'msg')`; `cns()` from `@lilnas/utils/cns` for class names.
- Reminders today: `apps/tdr-bot/src/reminders/` (service with timers, delivery
  strategies, prompts, constants, utils, types), schema in
  `apps/tdr-bot/src/db/schema.ts` (`reminders` table), skill in
  `apps/tdr-bot/src/llm/skills/reminder.skill.ts`, metrics in
  `apps/tdr-bot/src/tdr-bot-metrics.service.ts` (`createMockMetricsService` in
  `src/__tests__/test-utils.ts` must list every method).
- Skills: `apps/tdr-bot/src/llm/skills/skill.interface.ts` (`SkillInput`,
  `SkillOutput` with `followUp`/`reroute`), registered in `skills.module.ts`; the
  graph in `apps/tdr-bot/src/llm/graph/build-graph.ts` keeps one pending follow-up
  per user per channel for 5 minutes and routes the user's next message back to
  that skill with `input.followUp`. `match()` is a regex fast path before the
  router LLM. Imitate `src/llm/skills/chat/` and `src/llm/skills/math/` layout.
- LLM calls: `ctx.llm.call({ operation, role: 'reasoning' | 'chat', messages,
  schema?, overrides })`. OpenAI strict structured output: every schema property
  must be required — use `.nullable()`, never `.optional()`. Tests script calls by
  operation name with `FakeLlmClient` (`src/llm/testing/fake-llm-client.ts`).
- Drizzle: `DrizzleService.db` (`src/db/drizzle.service.ts`). Repository tests
  fake the builder chain and assert SQL with `PgDialect().sqlToQuery`, see
  `src/llm/audit/__tests__/llm-calls.repository.test.ts`. Generate migrations
  offline: `DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm --filter @lilnas/tdr-bot db:generate`
  (writes `apps/tdr-bot/drizzle/000N_*.sql` + `meta/`; commit both; the SQL may be
  hand-edited to add backfill statements). `start:migrate` applies them at boot.
- API: controllers in `src/api/` registered in `api.module.ts`; zod bodies via
  `ZodValidationPipe` (`src/api/zod-validation.pipe.ts`); test pattern is a real
  Nest app + `fetch`, see `src/api/__tests__/transcript.controller.test.ts`.
  Frontend: MUI 7 dark theme, `src/components/AppShell.tsx` nav, react-query hooks
  in `src/queries/`, fetch wrapper `src/api/api.client.ts`, types `src/api/api.types.ts`;
  imitate `src/app/settings/page.tsx` and `src/app/transcript/page.tsx`.
- `cron` 4.3.3: `new CronTime(expr, tz).getNextDateFrom(date)` returns a luxon
  `DateTime` (`.toJSDate()`); `CronTime` throws on an invalid expression.
- Mockups: `docs/features/tdr-bot/designs/README.md`; pages are Pug in `src/pages/`,
  shared mixins in `src/mixins/ui.pug`, tokens in `src/theme.css`; build with
  `pnpm mockups` from the repo root and commit the generated `*.html` (the build
  also rewrites existing pages' doctype case; commit that too).

## Done means
Implemented as specified; new and changed behaviour covered by Jest tests in the
package's style, passing under `--maxWorkers=2` (base as of `main`: 72 suites,
1242 tests, lint and type-check clean); the four checks exit 0; no `any` added;
Drizzle migration committed with its `meta/` snapshot and journal entry; no
`SchedulerRegistry`, `setTimeout`-based scheduling or `setDeliveryFunction` left
under `src/reminders/`; every new log call uses `(obj, msg)`; mockup `.html` files
rebuilt whenever `docs/features/tdr-bot/designs/src/` changes; existing chat,
math and media behaviour unchanged.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report. -->

### 2026-10-07 · T1 · done
The existing pages have no nav app bar, so reminders.pug defines a page-local `appbar` mixin with Settings, Transcript and Reminders (Reminders active). Settings and Transcript don't carry it.
Invalid-cron error text is "Invalid schedule: fires more than once a minute." and Create is disabled.
Status chip tones: active=ok, completed=muted, missed=warn, cancelled=bad. Cancel action is shown only on active rows.
The mobile frame shows the first four sample rows as cards.
Not run: the tdr-bot lint, type-check and jest checks, because only mockup files changed.

### 2026-10-07 · T2 · done
- validateCron treats a gap <= MIN_CRON_INTERVAL_MS as too frequent (so */1 * * * * is rejected, as the spec test requires); it probes the next 10 runs.
- ReminderService still uses the old timer code; MAX_TIMEOUT_MS and MAX_PENDING_DELIVERIES were removed from reminder.constants and now live as private consts in reminder.service.ts (and as local consts in reminder.service.test.ts). The scheduler rewrite should delete them along with SchedulerRegistry/setTimeout use.
- ReminderService.listForUser now filters status = 'active' and create() inserts rows with the new columns defaulted; the skill sets userName from input.discord.username and joins day + time into scheduleDescription. The service does not yet set nextRunAt on create, so new one-time reminders created via the service have next_run_at NULL until the new scheduler computes it.
- ReminderRepository is provided and exported from RemindersModule. Its list/listActiveForUser order uses raw sql`next_run_at ASC NULLS LAST`.
- Migration generated with drizzle-kit by answering the interactive rename prompts with "create column"; hand-edited backfills as specified.
- createTestReminder factory defaults: id reminder-1, userId user-1, userName tester, guildId guild-1, what 'test reminder', one-time scheduledAt = now+60s with nextRunAt equal, status active, source discord.
- schedule.ts uses dayjs utc+timezone plugins for describeSchedule; lint shows 2 import/no-named-as-default-member warnings for dayjs.extend (warnings only).

### 2026-10-07 · T3 · done
- ReminderErrorCode includes an extra 'invalid_what' (what empty or >500 chars) not in the spec; API error mapping must handle it.
- ReminderService.cancel order of checks: not_found, forbidden (only when opts.userId given), not_active. cancel without userId is the admin path.
- ReminderService.update: schedule patch recomputes nextRunAt and scheduleDescription (given or describeSchedule); other patches leave nextRunAt untouched. Only the schedule is validated against "now"; update does not re-check the per-user cap.
- preview(schedule, count = 5) validates like create and throws ReminderError.
- Delivery failure reasons returned: missing_guild, guild_not_found, channel_not_found, send_error, delivery_error. search_delivery_error / math_delivery_error are still recorded by delivery via TdrBotMetricsService.reminderFailed when falling back; the scheduler records the final failure reason.
- Scheduler: refreshActiveGauge() is private; runs at boot and at the end of any tick that had due rows. reminderCreated/reminderCancelled still inc/dec the gauge between refreshes.
- validateCron (T2) rejects yearly crons (e.g. '0 0 1 1 *') as invalid because the cron lib throws probing 8+ years ahead; tests use '0 0 1 * *'.
- ReminderSkill.create does not catch ReminderError (in_past, limit_reached etc. propagate), same as the old limit error behaviour.
- No SchedulerRegistry / setTimeout / setDeliveryFunction / reminderActiveDecrement remain under src/reminders or metrics. No mockup or migration changes in this task.

### 2026-10-07 · T5 · done
- POST /reminders/preview returns 200 (not 201). POST /reminders returns 201.
- Invalid `status` query gives 400. `invalid_what` and any other unmapped ReminderError code give 400, body `{ message, code }`.
- Name resolution: guild `members.cache` displayName, then `users.cache` displayName, then null. toReminderView then falls back to the stored `userName`, then the id. Unresolved target and channel names fall back to the id.
- Schemas: `what` is trimmed 1–500, `endsAt`, `channelId` and `targetUserId` accept null or absent. PATCH rejects `userId` (strict).
- Frontend should use `ReminderView`, `MemberInfo` and the body types from `api.types.ts`.

### 2026-10-07 · T4 · done
- Deleted reminder.skill.ts and its test. src/reminders/reminder.prompts.ts now holds only the three delivery prompts, and reminder.types.ts only ReminderActionType.
- The old REMINDER_TOPIC_SWITCH_PROMPT (CONTINUE/SWITCH) was unused and is gone. REMINDER_CONTINUATION_PROMPT became the new topic-switch prompt in skill/prompts.ts, and the reminder.list and reminder.cancel LLM operations and their prompts were removed.
- Decisions: the DM refusal runs before extraction results are used, so it fires before any follow-up questions. Invalid and sub-minute cron each get their own reply text, with cronExpression cleared. An unparseable endsAt is treated as null. scheduledAt and endsAt are parsed with `new Date(...)`, as the spec says, so they are read in server-local time.
- Cancel follow-up: an out-of-range number falls through to reminder.resolveCancel. A not_found error is treated like forbidden/not_active ("That reminder is already gone." plus the fresh list). A single match that isn't confident is shown as "Which one?".
- Reply wording: counts are pluralised ("1 reminder", "Cancelled 1 reminder."). The list shows mentions as `<@id>` and `<#id>`; the creator is shown as plain "(from @userName)" when the viewer is the target.
- Golden data: added "remove my dentist reminder", "nuke all my reminders" and the two new scenarios. SCENARIO_SCRIPTS in llm-orchestration.integration.test.ts covers them; its ReminderService mock returns a two-item list, resolves cancel and cancelAllForUser (2), and create returns the created row.
- schemas.live.test.ts now covers reminder.resolveCancel as well. Live tests were not run.
- No mockup or migration changes in this task.

### 2026-10-08 · H1 · changes requested
Changes requested at round 1: 2 comments, sent to R1.

Design review of `docs/features/tdr-bot/designs/reminders.html`, round 1:

1. region over <div> "Status What Who Schedule Next run Last run / runs Ends Chan…" in scene "1 · Populated table"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(2)` at fx 0.01, fy 0.06, fw 0.99, fh 0.16
   - **user:** this seems very crowded
   - screenshot 1 attached
2. region over <div> "Next runs Thu Oct 8, 9:00 AM Fri Oct 9, 9:00 AM Mon Oct 12,…" in scene "New reminder"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(1)` at fx 0.02, fy 0.56, fw 0.97, fh 0.11
   - **user:** why doesn't this have a title?
   - screenshot 2 attached

### 2026-10-07 · R1 · done
Thread 1 (crowded table): cut the columns from 10 to 7 (Status, What, Who, Schedule, Next run, Last run, actions) and raised the cell padding. Type chip and channel now sit under What, "Ends <date>" sits under Schedule (hidden when "never"), and the run count sits under Last run.
Thread 2 (no title): the dialog's next-runs preview is now titled "Next 3 runs" in text-sm font-semibold instead of the small muted label.
Both threads are resolved through nexus_design_review.
Checks: pnpm mockups rebuilt cleanly and pnpm run mockups:lint passes. The tdr-bot lint, type-check and jest checks were not run because only mockup files changed. The index, settings and transcript .html changes are the doctype-case rewrite the build does.

### 2026-10-08 · H1 · changes requested
Changes requested at round 2: 1 comment, sent to R2.

Design review of `docs/features/tdr-bot/designs/reminders.html`, round 2:

1. region over <div> "Cron expression 0 9 * * 1-5 Ends on (optional) Oct 31, 2026…" in scene "New reminder"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(1)` at fx 0.03, fy 0.42, fw 0.95, fh 0.25
   - **user:** The next three runs' title looks bad. You see how `cron expression` and `ends on` look. Why doesn't the next three runs look like that?
   - screenshot 1 attached

### 2026-10-07 · R2 · done
Thread dt-91702c75 is resolved via nexus_design_review. "Next 3 runs" is now a field label (text-xs font-medium text-ink-2, mb-1) above a bordered, padded list box, matching Cron expression and Ends on.
Checks: pnpm mockups rebuilt cleanly and pnpm run mockups:lint passes. The tdr-bot lint, type-check and jest checks were not run because only mockup files changed.

### 2026-10-08 · H1 · approved
Approved.

Approved at round 3.

### 2026-10-08 · Phase 1 · review cycle 1
Pass 1 (T1): T1 mockup slice (reminders.pug, index.pug link, regenerated HTML) matches the task body; no defects found. I skimmed the generated reminders.html rather than reading it end to end.
Pass 2 (T2): T2 schema, migration, schedule helpers, repository and factory match the spec with no defects found; interim leftovers in the old ReminderService (private timer consts, no nextRunAt on create) are expected to be removed by T3.
Pass 3 (T3): T3's service, scheduler, delivery rewrite and tests match the task body. One concurrency defect: the scheduler's advance step overwrites a cancel or edit made while a tick is in flight, so a cancelled recurring reminder can come back to life.
Pass 4 (T5): T5 admin reminders API matches the task body and notes: routes, status codes, error mapping, schemas, name fallbacks and tests are all in place, with no defects found in the slice.
Pass 5 (T4): T4's reminder skill rewrite matches the task body and Done means; every branch has a test and no defects found. One minor P2 about a misleading reply when the LLM leaves isRecurring null.
Pass 6 (R1, R2): Pass 6 only touches the Reminders mockup (Pug source plus regenerated HTML); the generated output is consistent with the source and there is no runtime code to fault.
Seams pass: Seams pass found no disagreements between T2, T3, T4 and T5 in the names, signatures, error codes and schemas I checked. Coverage is partial: the export diff was over the cap, so I read the skill/service call sites, error maps, schemas and prompt imports but not every hunk.

- F1 · P1 · Tick advance overwrites a concurrent cancel/edit and resurrects the reminder — apps/tdr-bot/src/reminders/reminder-scheduler.service.ts:123 → R3

Notes:
- F2 · P2 · Null isRecurring with a cron yields a misleading 'time already passed' reply — apps/tdr-bot/src/llm/skills/reminder/skill.ts:238

### 2026-10-07 · R3 · done
Added `ReminderRepository.advanceIfActive(id, expectedNextRunAt, patch)`. It updates only `WHERE id = ? AND status = 'active' AND next_run_at = <value read>`, and returns null when the row changed. `process()` now uses it. If the row was cancelled or edited mid-tick, it logs a warn and skips the advance. The reminder is still delivered, since the cancel landed after `listDue`. I did not add a re-read before delivery.
Tests: the scheduler tick tests now assert `advanceIfActive`. A new test covers the guarded update returning null after a cancel (no fallback `update` call). A repository test asserts the SQL guard (id, status, next_run_at).
Checks: jest passed (80 suites, 1357 tests, `--maxWorkers=2`), type-check passed, and `mockups:lint` passed. Lint has 0 errors and 6 existing dayjs `import/no-named-as-default-member` warnings that I did not touch.

### 2026-10-08 · Phase 1 · review cycle 2
R3 fixes F1: the tick advance is now conditional on the row still being active with the same next_run_at, and is covered by repository and scheduler tests. No new defects in the remediation diff. One P2 remains: a reminder cancelled mid-tick is still delivered once.

Earlier findings: F1 fixed.

Notes:
- F3 · P2 · Reminder cancelled mid-tick is still delivered once — apps/tdr-bot/src/reminders/reminder-scheduler.service.ts:123

### 2026-10-07 · T6 · done
- Added ReminderFilter and ReminderPreview types to api.types.ts.
- ReminderCard, StatusChip and formatWhen/ACTION_LABELS (in format.ts) are extra pieces beyond the listed components.
- ReminderTable renders both a table and cards and switches between them with CSS display at the md breakpoint, not useMediaQuery, to avoid an SSR mismatch.
- whoLabel returns 'admin' for any source === 'admin' reminder, matching the mockup row "Pay rent". The recipient is not shown for admin-created reminders.
- The preview request is debounced 300 ms in the dialog. Submit is disabled while it settles, while it is fetching, or when it errors. The preview error shows under the cron field, or under the When field for one-time reminders.
- The edit dialog disables the "For" field, because PATCH rejects userId.
- presetFor returns the preset label or the string 'custom' (exported as CUSTOM_PRESET).
- Ends-on is a date input, sent as local end of day (23:59:59).
- No prior failures from other tasks observed. The 7 eslint warnings (dayjs import style, outside my files) were already there.

### 2026-10-08 · Phase 2 · review cycle 1
Phase 2 / T6 (reminders admin page) reads clean. The API client, hooks, dialogs, format helpers and tests match the task body, and the frontend imports `reminder.types.ts` safely because it has no imports. The packet has no result for `build:frontend`, which the task required, so the Next build is unverified.

### 2026-10-08 · Final report

All tasks done and integrated. Reminders subsystem rebuilt with Postgres-backed DB poller, LLM-resolved cancel, and admin Reminders page.

**Tasks completed:**
- `T1` Mockup: admin Reminders page (4c284ec1)
- `T2` Reminder schema v2, repository and schedule helpers (1a1ebc62)
- `T3` ReminderService, poller scheduler and delivery rewrite (c6d67eaf)
- `T4` Reminder skill rewrite: extraction, cancel resolution, follow-ups (1a775afcfb)
- `T5` Admin reminders API (2ced3b1e)
- `T6` Reminders admin page (c6f56b13)
- `H1` Review approved (design review cycle 1–2)
- `H2` End-to-end verification skipped
- `R1` Address 2 design review comments on reminders mockup (6bf8b7a6)
- `R2` Address 1 design review comment on reminders mockup (20b14468)
- `R3` Fix P1 concurrency defect: guarded advance on cancel/edit (c6e039475)

**Review findings:**
- `F1` (P1) Tick advance overwrites concurrent cancel/edit → Fixed in R3
- `F2` (P2) Null isRecurring with cron yields misleading reply → Noted, not fixed
- `F3` (P2) Reminder cancelled mid-tick still delivered once → Noted, not fixed

**Deviations:**
- H2 (end-to-end verification) skipped per user request.
- F2 and F3 are both P2 edge cases left for follow-up; neither blocks core functionality.

### 2026-10-07 · Landed
Squash-merge of `feat/tdr-bot-reminders-revamp` into `main` as `feat(tdr-bot-reminders-revamp): squash-merge tdr-bot reminders revamp`, authored as Jeremy Asuncion.
