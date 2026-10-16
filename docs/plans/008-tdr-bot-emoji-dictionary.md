---
nexus-plan: 2
title: tdr-bot auto-maintained emoji dictionary
branch: feat/tdr-bot-emoji-dictionary
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
commit-style: "conventional with scope, e.g. feat(tdr-bot): …, fix(tdr-bot): …, test(tdr-bot): …, docs(tdr-bot): …"
---

# tdr-bot auto-maintained emoji dictionary

## Goal
tdr-bot's custom-emoji dictionary (`'<:name:id>' → when to use it`, inlined
into every system prompt) is a hand-maintained file, `apps/tdr-bot/src/utils/emojis.ts`,
that rots whenever someone adds, renames or deletes an emoji in Discord. Move it
into Postgres and let the bot maintain it: a new `emoji_dictionary` table, one
idempotent reconcile routine (sync metadata from `guild.emojis.cache`, then fill
missing descriptions, from the old file first and then from a vision model,
`gpt-6-luna` by default), run on boot, on Discord emoji events, and nightly.
`PromptService` and the reminder delivery prompts read the dictionary from the DB.
An admin page lists every emoji and lets a person edit a description,
re-describe one, or run a reconcile. Out of scope for this run: deleting
`emojis.ts` (a follow-up once prod has populated) and deploying.

## Decisions
- **The database is the source of truth.** `emoji_dictionary` replaces the
  static file; the `<:name:id>` / `<a:name:id>` key is derived when the prompt
  is built, never stored. Ruled out: a script that rewrites `emojis.ts` and
  commits (A), a CI job that opens PRs (C).
- **One reconcile, two idempotent phases.** Phase 1 (no LLM) upserts
  id/guild/name/animated for every emoji the bot can see, clears `deleted_at`,
  and soft-deletes rows whose emoji is gone. Phase 2 fills rows with
  `description IS NULL AND deleted_at IS NULL`: from the `emojis.ts` map by id
  (`source='manual'`, no LLM), else via the describer (`source='ai'`,
  concurrency 4). Crash-safe: a half-done run resumes next time.
- **Triggers:** `clientReady` (fire-and-forget, never blocks startup);
  `emojiCreate` / `emojiUpdate` / `emojiDelete` (needs the
  `GuildEmojisAndStickers` intent, not enabled at base); a nightly `@Cron`.
  Races are handled by an in-process mutex plus the "AI only fills NULL
  descriptions" conditional update. Ruled out: polling-only.
- **Initial population is the first boot.** No seed migration: phase 2's
  lookup in `emojis.ts` copies the ~140 hand-written descriptions.
  `emojis.ts` stays for this release and is deleted in a follow-up.
- **Describer:** `LlmClient.call` with `operation: 'emoji.describe'`,
  `role: 'chat'`, `overrides.model` from one constant (default `gpt-6-luna`;
  `gpt-6.1-sol` is a one-line swap), schema
  `{ description: string ≤ 120 }`, a system prompt with 8–10 few-shot
  `source='manual'` examples, and a `HumanMessage` with the name ("(animated)"
  hint) plus the `.png` CDN URL at `detail: 'low'`, even for animated emojis.
  No image bytes are downloaded and no image hashing in v1. It asserts the
  model has `capabilities.vision`. Ruled out: Astra / Terra (cost).
- **Catalog gains `gpt-6-luna`** ($0.10 / cached $0.01 / out $0.50 per 1M) and
  **`gpt-6.1-sol`** ($2 / $0.10 / $10), `reasoning(true)`, text roles (verified
  on OpenAI's model pages 2026-10-14).
- **Prompt text is unchanged in format**; partial coverage for a minute on the
  first boot is acceptable.
- **Admin page:** list (image, name, description, source, model, described,
  deleted), inline edit (sets `source='manual'`), per-emoji re-describe,
  "run reconcile now". A sync never overwrites a description.
- **Renames keep the description; a re-added emoji (same id) clears
  `deleted_at`.**
- **Planner choices:** a per-call `overrides.reasoningEffort` on `LlmCall`
  (reasoning tokens count against `maxTokens`, so the describer runs at
  `low` with a 400-token cap); `source` is NULL until a row is described;
  the AI write is `UPDATE … WHERE description IS NULL`, while admin edit and
  re-describe overwrite; soft-delete skips guilds that are unavailable at
  that moment; two Nest modules (dictionary cache vs. sync/triggers) so the
  prompt modules don't pull in event listeners.
- **Dev first.** The dev bot (own guild, own DB) is the test bed before prod
  (H2). Prod's first boot describes only emojis missing from `emojis.ts`.

## Context
- pnpm + Turbo monorepo; all code is in `apps/tdr-bot` (NestJS 11 + necord 6.11
  + discord.js 14.23 backend; Next.js 15 + MUI 7 + react-query admin UI in
  `src/app/`, same package). Checks, from the repo root:
  `pnpm --filter @lilnas/tdr-bot lint` (fix: `… lint:fix`), `… type-check`,
  `… exec jest --maxWorkers=2` (never more workers: this host is the
  production server; read the `Tests:` line), `pnpm run mockups:lint`.
- Jest tests live in `__tests__/` beside the source, `.ts` only (`.tsx` is
  not tested). `src/__tests__/setup.ts` globally mocks discord.js (few exports)
  and necord; don't edit it. Add per-file `jest.mock('discord.js', …)` as
  `src/commands/__tests__/download-command.service.test.ts` does. Drizzle
  repositories are tested with a fake chain + `PgDialect().sqlToQuery` as in
  `src/llm/audit/__tests__/llm-calls.repository.test.ts`. Script LLM calls by
  operation with `FakeLlmClient` (`src/llm/testing/fake-llm-client.ts`).
- Style: `src/...` import alias, no semicolons, single quotes, `arrowParens:
  avoid`, no `any`, pino-style `logger.log({ obj }, 'msg')`, `dedent` for
  prompts.
- DB: Drizzle + Postgres, schema in `src/db/schema.ts`, migrations in
  `apps/tdr-bot/drizzle/` (latest `0006_…`). Generate with `pnpm db:generate`
  from `apps/tdr-bot` (needs no database). Never run `db:migrate`/`db:push` or
  touch any database; `start:migrate` applies migrations on boot.
- LLM: `LlmClient.call` (`src/llm/client/`), models in `src/llm/models/catalog.ts`
  + `ModelRegistry` (throws on unknown ids), `LlmCoreModule` exports both.
- Admin API: Nest controllers in `src/api/` (routes have no prefix; Next
  rewrites `/api/*` to them), registered in `src/api/api.module.ts`; client
  calls in `src/api/api.client.ts`, types in `src/api/api.types.ts`, hooks in
  `src/queries/`. Imitate `src/api/reminders.controller.ts` and
  `src/app/reminders/`.
- If Bash or Jest fails with ENOSPC on `/tmp` (inodes), set `TMPDIR` under
  `$HOME` for that run and remove it afterwards.

## Done means
Implemented as the task specifies; new behaviour covered by Jest tests in the
package's style, passing under `--maxWorkers=2` (base as of `main` 7438ecf0:
89 suites, 1574 tests); all checks exit 0 and lint shows no warnings beyond the 6
dayjs `import/no-named-as-default-member` warnings at base; no `any` added;
`src/__tests__/setup.ts` unchanged; no new environment variables; every new log
call uses `(obj, msg)`; `src/utils/emojis.ts` unchanged; exactly one new
migration under `apps/tdr-bot/drizzle/`, generated by drizzle-kit; nothing
deployed and no database touched.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-10-15 · T1 · done
Mockup only. `+appbar(active)` now lives in ui.pug; only reminders and emojis use it (settings/transcript never had an app bar).
Emoji ids for non-listed rows are invented (sequential 5643100728223334xx); the four given ids are real.
Sample model name in the mockup is "gpt-5-mini". Description max is 300 per the brief.
The mockup's table columns are: image, name, description, source, model, described, actions.

### 2026-10-15 · T2 · done
- Added catalog entries gpt-6-luna and gpt-6.1-sol after o4-mini. Both use reasoning(true) and TEXT_ROLES. The pricing comment notes they were checked on 2026-10-14. DEFAULT_MODELS is unchanged.
- New exported type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' in src/llm/client/llm-call.types.ts. Both LlmCall.overrides.reasoningEffort and ResolvedParams.reasoningEffort use it. The task wrote the union inline twice; I used one shared alias instead.
- DefaultLlmClient.call uses call.overrides?.reasoningEffort ?? settings.reasoningEffort, only when caps.reasoningEffort is true.
- OpenAiProvider type-checks unchanged. No casts were needed.
- Settings schema still allows only low/medium/high.
- Checks: lint has 0 errors and the 6 dayjs warnings already at base. type-check is clean. Jest passes 89 suites / 1578 tests. mockups:lint exits 0.
- No migration was added by this task.

### 2026-10-15 · T3 · done
- Migration is drizzle/0007_cute_grey_gargoyle.sql, generated by drizzle-kit; it has not been applied anywhere.
- EmojiDictionaryRepository (src/emojis/emoji-dictionary.repository.ts) is @Injectable and takes DrizzleService. There's no module yet: T6 must add it to a module's providers, and DrizzleService must be available there.
- Decision: softDelete and softDeleteMissing set updated_at = now() as well as deleted_at.
- Decision: listUndescribed, listActiveDescribed and listAll return rows ordered by id ascending; listManualExamples is ordered by id with LIMIT, as specified.
- upsertMeta updates guild_id, name and animated from excluded.*, sets deleted_at = NULL and updated_at = now(), and never touches description, source, model or described_at.
- softDeleteMissing skips the id filter when keepIds is empty and skips the guild filter when skipGuildIds is empty, so ([], []) soft-deletes every live row.
- Checks: lint shows 0 errors and only the 6 dayjs warnings from base; type-check passes; jest has 90 suites and 1591 tests passing; mockups:lint passes.

### 2026-10-15 · T4 · done
- EmojiDescriberService(llm: LlmClient, registry: ModelRegistry) is not registered in any module yet. T7 should import LlmCoreModule, which exports both dependencies.
- Example handling: if fewer than 8 are given (8 is the fallback count), fallbacks are appended, skipping names already present. The result is then capped at EMOJI_EXAMPLE_COUNT (10). If 8 or more are given, they are just sliced to 10.
- The vision check throws a plain Error whose message names the model and mentions "vision". An unknown model id still throws UnknownModelError from registry.get.
- prompts.ts imports EmojiExample from service.ts as a type only (`import type`), so there is no runtime circular import.
- All catalog text models have vision, so the non-vision test spies registry.get and returns the real gpt-6-luna spec with vision set to false.
- Checks: lint has 0 errors and the 6 dayjs warnings already at base. type-check is clean. Jest passes 90 suites / 1589 tests. mockups:lint exits 0.
- No migration was added by this task.

### 2026-10-15 · T5 · done
- Live run PASSED (3/3) on gpt-6-luna with the T4 settings unchanged (reasoning effort 'low', EMOJI_DESCRIBE_MAX_TOKENS 400). Every call had finish_reason 'stop'. LangChain's default response_format JSON schema path works, so 'none'/'minimal' were not needed.
- Descriptions:
  - HYPERS: "Use this when excited about something"
  - peepoWine (animated): "Use this to toast, celebrate, or enjoy a relaxing drink."
  - Loading: "Use this when waiting for something to load or finish."
  All three say when to use the emoji, so the system prompt is unchanged. HYPERS copies its fallback example word for word, which is expected because it is in the examples.
- Cost: $0.0002 for the file (ceiling $0.50).
- src/__tests__/setup.ts silences console.log unless DEBUG is set, so the description lines only show with DEBUG=1 added to the plan's command. Jest also warns "did not exit one second after" at the end of the run; it still exits. --forceExit removes the warning.
- Checks: lint 0 errors + the 6 dayjs warnings already at base. type-check clean. Jest 91 suites / 1606 tests pass (live file skipped). mockups:lint exits 0.

### 2026-10-16 · H1 · approved
Approved.

### 2026-10-16 · Phase 1 · review cycle 1
Pass 1 (T1): T1 is a mockup-only slice (Pug source plus regenerated HTML); every frame the task body lists is present, the shared +appbar mixin now carries the four-item nav, and the sample-data filter counts are internally consistent. No application code or tests were touched, so there are no correctness or Done-means findings. Settings/transcript pages still lack an app bar, which the task notes explain (they never had one).
Pass 2 (T2, T3, T4, T5): T2–T5 match their task bodies: catalog/override wiring, migration chain, repository SQL and describer behaviour are all correct and tested as required. No seams found between the four tasks.
Seams pass: Seams pass: T2's ReasoningEffort/catalog entry, T3's repository types, T4's describer and T5's live test all agree at the export level; no disagreements found. Phase 2's reconcile will need to map EmojiRow (nullable description) to EmojiExample before calling describe().

Notes:
- F1 · P2 · Schema max length checked before trim — apps/tdr-bot/src/emojis/emoji-describer.service.ts:36

### 2026-10-16 · T6 · done
- EmojiDictionaryModule (src/emojis/emoji-dictionary.module.ts) imports DrizzleModule and provides and exports EmojiDictionaryRepository and EmojiDictionaryService. T7 and the admin API should import this module, not provide the repository again.
- EmojiDictionaryService.refresh() reloads listActiveDescribed(), sorts by BigInt(id), and rebuilds the text through formatEmojiDictionary. It throws if the repository throws; only onModuleInit catches the error and logs it with logger.error({ err }, msg). Callers that write to the table (reconcile, admin edits) should call refresh() afterwards.
- Rows whose description is null are skipped. listActiveDescribed already filters them out, so this only satisfies the type.
- refresh() logs { count } 'Emoji dictionary loaded' on every call.
- formatEmojiDictionary(emojis) was checked once to be byte-identical to the old EMOJI_DICTIONARY, using a throwaway test that was then deleted.
- Reminder prompts are now built per LLM call from emojiDictionary.promptText().
- Nothing imports src/utils/emojis.ts. It is unchanged; only a comment in emoji-describer.prompts.ts mentions it.
- No migration was added in this task; T3's 0007 is the only new one for the feature.
- Checks: lint 0 errors with the 6 dayjs warnings from base; type-check passes; jest has 93 suites and 1616 tests passing; mockups:lint passes.

### 2026-10-16 · T7 · done
- EmojisModule imports EmojiDictionaryModule and LlmCoreModule. It provides EmojiDescriberService and EmojiSyncService, and exports EmojiSyncService and EmojiDictionaryModule. Nothing imports it yet; T8 adds it to AppModule.
- reconcile(trigger): a second call while a run is in flight gets back the same promise object, and the summary keeps the first call's trigger. status().running is true from the moment reconcile() is called until its promise settles, which includes time spent waiting for the mutex behind syncEmoji/removeEmoji.
- When the client is not ready, reconcile logs a warn ({ trigger }, ...), returns a zero summary and still records it as status().last. It does not emit the 'emoji.reconcile' log in that case.
- syncEmoji skips an emoji whose name is null, with a warn log. It runs upsertMeta on that one emoji, then phase 2, which ends with dictionary.refresh(). It logs ({ emojiId, name, seeded, described, failed }, 'emoji.sync'). removeEmoji logs ({ emojiId }, 'emoji.remove').
- Phase 2 calls dictionary.refresh() after seeding only if at least one row was seeded, and always calls it once at the end. Manual examples are loaded only when some rows still need the LLM, so a run where everything is described makes no extra queries and no LLM calls.
- Describe failures are logged as warn({ emojiId, name, error: getErrorMessage(err) }, 'Failed to describe emoji'). If fillDescription itself throws, that is also counted as failed.
- redescribe does not take the mutex, so an admin request never waits behind a long reconcile. setDescription can only race with fillDescription, which writes only to NULL descriptions, so the two can't clobber each other. If setDescription returns undefined (the row vanished), redescribe throws EmojiNotFoundError.
- Error class names are set ('EmojiNotFoundError' / 'EmojiDeletedError'), so T9 can map them to 404/409 with instanceof.
- The tests use an in-memory FakeRepo and a typed jest.fn in place of the describer. There is no per-file discord.js mock: the service needs Client at runtime and the global setup mock provides it, and the test imports discord.js types only.

### 2026-10-16 · T8 · done
- EmojiEventsService (src/emojis/emoji-events.service.ts) is in EmojisModule's providers but not its exports. Handlers: onClientReady (@Once('clientReady'), starts reconcile('boot') and does not await it), onEmojiCreate, onEmojiUpdate (passes the new emoji, the second item of the context tuple), onEmojiDelete (removeEmoji(emoji.id)), and onNightly (@Cron(EMOJI_RECONCILE_CRON), awaits reconcile('cron')).
- Error logs: ({ trigger, error }, 'emoji.reconcile.failed'), ({ emojiId, error }, 'emoji.sync.failed') and ({ emojiId, error }, 'emoji.remove.failed'). error comes from getErrorMessage.
- AppModule imports EmojisModule and adds IntentsBitField.Flags.GuildExpressions (8). ScheduleModule.forRoot() was already there.
- Skipped the AppModule intents test: importing app.module.ts runs env() and NecordModule.forRoot, and the global necord mock has no forRoot, so it can't be done without booting the app.
- Checks: lint 0 errors with the 6 base dayjs warnings; type-check clean; jest 96 suites / 1645 tests pass; mockups:lint exit 0. This task adds no migration (the plan's one migration came from an earlier task).

### 2026-10-16 · T9 · done
- Routes: GET /emojis, PATCH /emojis/:id, POST /emojis/:id/redescribe (200 on success), POST /emojis/reconcile (always 202, body { started }).
- EmojiView.source is typed as EmojiSource ('manual' | 'ai') from src/db/schema, the same as the spec's literal union.
- The validation schema lives in src/api/emojis.schema.ts (strictObject, description trimmed, 1–300 characters). A 400 response carries { message, issues } from ZodValidationPipe.
- Redescribe errors come back as Nest exceptions, so the client receives `message` (for example "Emoji 1 is deleted") through ApiRequestError.
- Reconcile failures are logged as logger.error({ error }, 'Admin emoji reconcile failed').
- ApiModule imports EmojisModule. It doesn't conflict with AppModule (T8) importing the same module, because Nest creates a module's providers only once.
- ApiClient methods: getEmojis(), updateEmoji(id, body), redescribeEmoji(id), reconcileEmojis().
- No migration was added because this task makes no schema change.
- Checks: lint has only the 6 dayjs warnings from base; type-check is clean; jest shows 96 suites and 1650 tests, all passing; mockups:lint is clean.

### 2026-10-16 · T10 · done
- /emojis page added to match docs/features/tdr-bot/designs/emojis.html, and an Emojis link added to NAV_LINKS.
- useEmojis uses a refetchInterval function: 3000 ms while data.reconcile.running is true, otherwise off. The mutation hooks invalidate ['emojis']. The page treats the reconcile as running while the POST is pending or while the server reports running.
- Filter decisions: "Needs description" means description is null and the row isn't deleted. "AI" and "Manual" include deleted rows, which matches the mockup's counts.
- reconcileStatusLine labels a run "Started … (manual)" only if no run has finished since the page clicked start. Other runs show "Reconcile running…". Trigger labels: cron is shown as "nightly", admin as "manual", event as "gateway event".
- Emoji images use the MUI Avatar component, which avoids next/no-img-element.
- Checks: lint has only the 6 dayjs warnings from base; type-check is clean; jest shows 98 suites and 1687 tests, all passing; mockups:lint is clean. No migration (no schema change), no new environment variables, no database touched.

### 2026-10-16 · Phase 2 · review cycle 1
Pass 1 (T6, T7): T6 and T7 match their task bodies and Done means: the DB-backed dictionary cache feeds the system and reminder prompts, the two-phase reconcile, event upserts and redescribe behave as specified, and every required test is present. No correctness defects found; one P2 note on redescribe example selection.
Pass 2 (T8, T9): Pass 2 (T8 triggers + T9 admin API) is clean: event/cron/boot handlers, controller error mapping, view mapping, sort order and ApiClient methods all match the task bodies, and the seams into T7's EmojiSyncService/EmojiDictionaryRepository (setDescription returning undefined, reconcile dedupe + status().running, EmojiSource union) agree. The AppModule intents test was skipped as the task body allows, with a justified note.
Pass 3 (T10): T10's admin Emojis page, hooks and pure-logic module are correct and agree with T9's types, client and controller; format.ts is tested as required. Only a cosmetic labelling edge remains.
Seams pass: Seams pass over T6–T10: module wiring (single EmojiDictionaryService instance shared via EmojiDictionaryModule), the ReconcileTrigger/ReconcileStatus type chain into the UI, repository and describer signatures consumed by the sync service and controller, the sync↔events contract, and the API client/hook/controller routes all agree. Only a duplicated CDN-URL helper (emoji-views.ts vs emoji-describer.service.ts, intentionally .gif vs .png) was noted, not a defect.

Notes:
- F2 · P2 · redescribe feeds the row's own manual description back as an example — apps/tdr-bot/src/emojis/emoji-sync.service.ts:177
- F3 · P2 · Ignored `started: false` can label another run as manual — apps/tdr-bot/src/app/emojis/page.tsx:56
- F4 · P2 · Discord CDN emoji URL built in two places — apps/tdr-bot/src/api/emoji-views.ts:10

### 2026-10-16 · Final report
- T1 · done · fd231f2e73f9572b4d6ce0a6bb4089f9b5248298 (mockup; approved at H1)
- T2 · done · fe97cf90be854d3d8f2749922f9edb7135bc8d63
- T3 · done · 35e195238de112b79f2c991240dfa3062b42b77b
- T4 · done · 9d7f295bbef5a834d12688ec43273184876bd1e4
- T5 · done · 673294eea3e9c0c3ae0786cc0638c48ae41e8f8b
- T6 · done · 905eb9982be0a54dedaa633ead17db2fde7a3e0b
- T7 · done · 4e743e5c1962698fd8a7d07f91b5196048c31859
- T8 · done · 84aa52838289cce60aef86926de1a92123db48b6
- T9 · done · be2c9caefcfa600c093361d60954db8a33f166c3
- T10 · done · 6a97947c892f39ec42da2c7e58faa7558ad63407
- H1 · approved (Emojis page mockup)
- H2 · skipped (try the emoji dictionary on the dev bot); dev bot not exercised by this run
- Deviations: T8 skipped the AppModule intents test (importing app.module.ts boots env() and NecordModule.forRoot; the necord mock has no forRoot). Its note says this is allowed by the task body.
- Unfixed review findings (all P2, none fixed in this run):
  - F1 (phase 1): `EmojiDescriptionSchema` applies `.max(120)` before `describe()` trims, so a valid 120-char answer with trailing whitespace is rejected. File: apps/tdr-bot/src/emojis/emoji-describer.service.ts:36.
  - F2 (phase 2): `redescribe` loads the row's own manual description as a "good" example, which biases the LLM toward the description being replaced. File: apps/tdr-bot/src/emojis/emoji-sync.service.ts:177.
  - F3 (phase 2): `startReconcile` sets `startedAt` before the response, so a `{ started: false }` reply still reads "Started just now (manual)". File: apps/tdr-bot/src/app/emojis/page.tsx:56.
  - F4 (phase 2): the Discord CDN URL is built in two places (`.gif` in emoji-views.ts, `.png` in the describer). Not a defect today. File: apps/tdr-bot/src/api/emoji-views.ts:10.
- Review cycle 1 settled as "clean" with these findings recorded as noted, not blocking.
- Events: the event log in this run's report is truncated (85 oldest events omitted); the plan and `git log` cover them.
- Open: F1 through F4 need a follow-up task or an explicit decision to accept. H2 still needs a manual run on the dev bot.

### 2026-10-16 · Landed
Squash-merge of `feat/tdr-bot-emoji-dictionary` into `main` as `feat(tdr-bot): auto-maintained emoji dictionary`, authored as Jeremy Asuncion.
