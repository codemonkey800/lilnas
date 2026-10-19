---
nexus-plan: 2
title: tdr-bot LLM playground and custom-emoji rendering
branch: feat/tdr-bot-llm-playground
base: main
setup:
  - pnpm install --frozen-lockfile
  - pnpm --filter @lilnas/utils --filter @lilnas/media build
checks:
  - pnpm --filter @lilnas/tdr-bot lint
  - pnpm --filter @lilnas/tdr-bot type-check
  - pnpm --filter @lilnas/tdr-bot exec jest --maxWorkers=2 src/api src/emojis src/utils src/messages/prompts src/app src/commands/tldr src/playground src/components src/llm/testing
  - pnpm run mockups:lint
parallel: 3
review: per-phase
review-model: frontier
design-model: frontier
commit-style: "conventional with scope, e.g. feat(tdr-bot): …, fix(tdr-bot): …, test(tdr-bot): …, docs(tdr-bot): …"
---

# tdr-bot LLM playground and custom-emoji rendering

## Goal
tdr-bot still chats on `gpt-4-turbo` because the one attempt to upgrade left the
newer model ignoring the custom-emoji dictionary that ends every system prompt.
There is no way to try a model before switching. Add an admin **Playground**:
`POST /playground/chat` calls the chat model directly (real persona prompt plus
the live emoji dictionary, optional unsaved prompt draft, any chat-capable
model, no router/skills/tools, no channel thread) and scores each reply with a
pure `analyzeEmojis()` (dictionary / hallucinated / unicode / shortcode). A
`/playground` page holds a conversation, shows model, cost, latency and the
score line per reply, and an Eval panel runs ten fixed prompts across chosen
models into a per-model table. A shared `<DiscordContent>` renders
`<:name:id>` / `<a:name:id>` as inline images (flagging ones outside the
dictionary) in the playground and the existing Transcript. `DEFAULT_MODELS`,
the production prompt, deploys and pushes are out of scope: measure first.

## Decisions
- **Stateless `POST /playground/chat`.** The browser keeps the history and
  sends `{ model, messages[{role, content}], systemPromptDraft? }`; the server
  rebuilds the real system prompt (intro + input format + saved or draft
  prompt + dictionary), calls `LlmClient.call` with `operation
  'playground.chat'`, `role 'chat'`, `overrides.model`, and never touches a
  channel's checkpointed thread. The draft is never persisted.
- **Direct chat model only.** No router, skills or tools: emoji obedience
  depends on the system prompt and the chat model.
- **Saved generation settings.** Temperature / reasoning effort come from
  Settings; the model dropdown and the prompt draft are the only variables.
  Ruled out: per-call temperature/effort controls.
- **Hallucinated = not an exact key in the prompt dictionary** (the same
  `listActiveDescribed` entries the model was shown), with a reason: unknown
  id, id known under another name, or wrong animated flag. The renderer flags
  an emoji only when its id is unknown to `GET /emojis` (deleted rows still
  render, dimmed), so old transcripts don't light up red.
- **Eval lives in the browser.** The Eval panel loops the fixed prompts × the
  ticked models through the same `/playground/chat` and aggregates the
  returned analysis; no eval endpoint, no DB in tests. Ruled out:
  `LIVE_LLM=1` eval (live tests have no DB, so it can't see the real
  dictionary). One small live test still crosses the OpenAI boundary.
- **Mockup first, then a human review**, like the Emojis page.
- **Planner choices:** playground messages are sent as `HumanMessage` named
  `paulbeenis420` (the intro maps it to Jeremy) unless the body gives
  `author`; `ModelSelect` moves to `src/components/ModelSelect.tsx`; the
  analyzer and the renderer share one tokenizer in
  `src/emojis/emoji-analysis.ts`, which imports nothing from Nest or Node so
  the Next.js bundle can use it; every task runs on the `frontier` tier.

## Context
- pnpm + Turbo monorepo; all code is in `apps/tdr-bot` (NestJS 11 backend;
  Next.js 15 App Router + MUI 7 (`sx` styling, no Tailwind in app code) +
  react-query admin UI in `src/app/`, same package). Checks, from the repo
  root: `pnpm --filter @lilnas/tdr-bot lint` (fix: `… lint:fix`),
  `… type-check`, `… exec jest --maxWorkers=2 <paths>` (never more workers
  and never the unscoped suite: this host is the production server; read the
  `Tests:` line), `pnpm run mockups:lint`.
- Jest tests live in `__tests__/` beside the source, `.ts` only (`.tsx` is
  not tested, so keep page logic in `.ts` modules and test those).
  `src/__tests__/setup.ts` mocks discord.js and necord globally; don't edit
  it. Controllers are tested over real HTTP with `Test.createTestingModule` +
  `app.listen(0)` as in `src/api/__tests__/emojis.controller.test.ts`. Script
  LLM calls by operation with `FakeLlmClient`
  (`src/llm/testing/fake-llm-client.ts`). Live OpenAI tests are
  `src/llm/testing/live/*.live.test.ts` (`describeLive`, `LiveLlm`,
  `recordCost` from `live-env.ts`), run with `LIVE_LLM=1 pnpm --filter
  @lilnas/tdr-bot exec jest --runInBand <file>`; the key comes from
  `apps/tdr-bot/.env` (never print it).
- Style: `src/...` import alias, no semicolons, single quotes, `arrowParens:
  avoid`, no `any`, pino-style `logger.log({ obj }, 'msg')`, `dedent` for
  prompts, `cns()` if a `className` is ever needed (MUI `sx` is the norm).
- LLM: `LlmClient.call` (`src/llm/client/llm-call.types.ts`: `operation`,
  `role`, `messages`, `overrides.{model,timeoutMs,maxTokens}`; returns
  `output`, `model`, `usage.{input,output,cached,costUsd}`, `durationMs`).
  Models: `src/llm/models/catalog.ts` + `ModelRegistry`
  (`isAllowedFor(id, 'chat')`, `get` throws on unknown ids). `LlmCoreModule`
  exports both plus `SettingsModule`. Prompt: `PromptService.getSystemPrompt()`
  (`src/messages/prompts/prompt.service.ts`, `PromptsModule`) = `PROMPT_INTRO`
  + `INPUT_FORMAT` + `settings.systemPrompt` + `EmojiDictionaryService
  .promptText()` (`src/emojis/`, `EmojiDictionaryModule`; keys are
  `emojiKey(row)` = `<:name:id>` / `<a:name:id>`, built by
  `formatEmojiDictionary` in `src/utils/prompts.ts`). `/tldr`
  (`src/commands/tldr/tldr.service.ts`) is the pattern for a Discord-free call.
- Admin API: Nest controllers in `src/api/` (no route prefix; Next rewrites
  `/api/*`), registered in `src/api/api.module.ts`; zod bodies via
  `ZodValidationPipe` (`src/api/zod-validation.pipe.ts`); client methods in
  `src/api/api.client.ts` (`parseOrThrow`), types in `src/api/api.types.ts`,
  hooks in `src/queries/`. `GET /emojis` returns every row incl. deleted
  (`EmojiView`: `id`, `name`, `animated`, `key`, `imageUrl`, `deletedAt`).
- UI: nav in `src/components/AppShell.tsx` (`NAV_LINKS`); pages imitate
  `src/app/settings/page.tsx` and `src/app/transcript/page.tsx`.
- Mockups: Pug in `docs/features/tdr-bot/designs/src/` (read its README),
  `pnpm mockups` from the repo root regenerates `*.html`; commit both.
- If Bash or Jest fails with ENOSPC on `/tmp`, set `TMPDIR` under `$HOME`
  for that run and remove it afterwards.

## Done means
Implemented as the task specifies; new behaviour covered by Jest tests in the
package's style, passing under `--maxWorkers=2` (the scoped test check at
`base` `d962d7b8`: 30 suites, 458 tests); all checks exit 0 and lint shows no
warnings beyond the 6 dayjs `import/no-named-as-default-member` warnings at
base; no `any` added; `src/__tests__/setup.ts`, `DEFAULT_MODELS`,
`KAWAII_PROMPT`, `formatEmojiDictionary` and `src/db/schema.ts` unchanged; no
new environment variables, migrations or dependencies; `POST /playground/chat`
never imports `LLMModule`, the graph or the checkpointer; every new log call
uses `(obj, msg)`; nothing deployed or pushed.

## Planner notes
- Base checks measured 2026-10-19 on `main` `d962d7b8`: lint 13 s (0 errors,
  6 dayjs warnings), type-check clean, scoped jest 30 suites / 458 tests in
  about 4 s; `pnpm run mockups:lint` passes.
- `llm_calls` rows with a null `channelId` are excluded from the Transcript
  channel list (`listRecentChannels` filters `is not null`), so playground
  audit rows don't create a phantom channel.
- Nexus plan frontmatter has no run-wide model/effort key, so every task
  carries `model: frontier` and the reviewer/design slots are `frontier`.
  Reasoning effort **high** must be set on the run config when it starts
  (`nexus_run_create` config overrides aren't applied from a planner session).
- Dev bot (`lilnas-tdr-bot-1`) runs from the Docker dev compose, not from a
  run worktree, so no task boots the app; the HTTP boundary is covered by the
  Nest-over-HTTP controller tests and the OpenAI boundary by T6.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-10-19 · T3 · done
`import { ModelSelect, ModelOption, priceLabel } from 'src/components/ModelSelect'`.
ModelSelect props: role, label, value, error?, disabled?, size?: 'small' | 'medium',
sx?: SxProps<Theme>, onChange(id). `size`/`sx` forward straight to TextField.
`usd` stays module-private (task only asked to export the other three).
Settings page now imports Box/MenuItem only where it still uses them; MenuItem,
ModelSpec and ModelRole imports were dropped from page.tsx as unused.
No Jest tests added: pure extraction, no new behaviour, and .tsx is not under Jest.

### 2026-10-19 · T2 · done
Module is dependency-free (no Nest/Node/discord.js imports) so the Next.js client can import it from 'src/emojis/emoji-analysis'.
Decisions: dictionary keys are parsed with an anchored copy of the token regex, so a key must be exactly one token to count; when an id appears in the dictionary under several keys the first wins for mismatch reasons. The 'name-mismatch' reason takes priority over 'animated-mismatch' when both differ. Unicode regex uses the `u` flag with \p{Extended_Pictographic}/\p{Emoji_Modifier}/\p{Regional_Indicator}; ©®™ are excluded only as the leading pictograph of a sequence. Keycap sequences (e.g. 1️⃣) are not matched — not in the spec. formatEmojiScore labels are invariant (no pluralisation), matching the spec's example.

### 2026-10-19 · T5 · done
`DiscordContent` imports `segmentCustomEmojis` from `src/emojis/emoji-analysis` and `EmojiLookup` from `src/queries/useEmojiLookup`; `useEmojiLookup` wraps `useEmojis()` and builds `byId: Map<id, EmojiView>` (deleted rows included, memoised).
Unknown-id tokens (lookup given + loaded) render a dashed `error.main` inline span titled "Not in the emoji dictionary"; known-but-deleted rows render the image at 0.5 opacity; no lookup / loading → plain image from `lookup.byId.get(id).imageUrl` or the Discord CDN (gif when animated). `onError` falls back to the raw token text.
`Box component="img"` lints clean without an eslint-disable; no new deps, env vars or migrations. Later pages (e.g. the Playground transcript) can reuse `DiscordContent` by calling `useEmojiLookup()` once at page level and passing `lookup` down.

### 2026-10-19 · T1 · done
Mockup conventions the implementation tasks should mirror:
- Inline custom emoji: <img> at `size-[1.375em]`, `inline-block align-middle object-contain`,
  src `https://cdn.discordapp.com/emojis/<id>.png|.gif`, alt/title `:name:`.
- Unknown emoji chip: raw `<:name:id>` text, monospace ~0.8em, dashed `border-bad` outline,
  `text-bad`, title "not in dictionary".
- Score chips under each assistant bubble: ok "N dictionary", bad "N hallucinated" (only when
  > 0), warn "N unicode", muted "N shortcode"; meta line "model · $cost · N.N s" in mono.
- Draft section is a <details>; "modified" warn chip in the summary when draft ≠ saved; counter
  "N / 20000"; "Reset to saved" link; footnote that intro + input format + emoji dictionary are
  always appended.
- Eval panel: 4 models ticked, "10 prompts" disclosure, "~$0.35 for 40 calls", progress "12 / 40",
  results table with the 8 specified columns, best "Replies with ≥1 dictionary emoji" rate bold.
- Transcript frames renumbered: 1 Conversation, 2 Conversation with custom emojis, 3 Empty, 4 Loading.
- Unicode emojis (🔥) show as tofu in the screenshot only because the host's mono font lacks
  emoji glyphs; the existing Emojis/Transcript mockups have the same limitation.
- The rebuild regenerated all 6 tdr-bot HTML pages (nav change); the download designs were
  rebuilt byte-identically and are not in the commit.

### 2026-10-19 · T4 · done
Endpoint: POST /playground/chat (Nest, no prefix; the Next client reaches it via /api/playground/chat). Body is PlaygroundChatBody; response is PlaygroundChatResponse; controller returns 200 explicitly (@HttpCode(200)), 400 for zod failures ({ message: 'Invalid request body', issues }) and for a disallowed/unknown model ({ message: "Model '<id>' is not available for chat" }), 504 on LlmTimeoutError, 502 on anything else with getErrorMessage(err).
Decisions: the model check uses registry.isAllowedFor only (no registry.get), so unknown and non-chat ids both map to PlaygroundModelError → 400. DEFAULT_PLAYGROUND_AUTHOR = 'paulbeenis420' lives in playground.service.ts and is applied in the service (the schema leaves `author` optional), passed through toMessageName. The draft is trimmed before use; empty/whitespace → saved prompt. PromptService.getSystemPrompt(options = {}) keeps TDR_SYSTEM_PROMPT_ID on the override. EmojiDictionaryService.keys() is Object.keys(entries) at call time (prompt order = snowflake order), no extra cache.
Scoped Jest check now reports 33 suites / 510 tests. No client method or react-query hook was added (api.client.ts / src/queries untouched) — that is for the UI task.

### 2026-10-19 · T6 · done
Live run: both models pass. gpt-4-turbo → "1 dictionary · 0 hallucinated · 1 unicode · 0 shortcode", reply "Hi everyone! <:HYPERS:…> My day's been super fun … 😊", $0.0073. gpt-5-mini → "4 dictionary · 0 hallucinated · 0 unicode · 0 shortcode" (run 1; HYPERS×2, peepoWine, Loading) and "2 dictionary · 0 hallucinated · 0 unicode · 0 shortcode" (run 3), $0.0024–$0.0030. Per-run total ≈ $0.0099 of the $0.50 ceiling; ran 3 times (~$0.03 total).
Two things the task's command didn't anticipate: (1) jest.config.js excludes *.live.test.ts from testMatch, so the file must be run with `--testMatch '**/*.live.test.ts'` (as `pnpm test:live` does) or Jest reports "No tests found"; (2) apps/tdr-bot/.env has no OPENAI_API_KEY (only Discord/download vars) — the key lives in the encrypted .env.prod. I decrypted it into the child process only with `pnpm exec dotenvx run --quiet -fk /home/jeremy/lilnas/.env.keys -f .env.prod -- pnpm --filter @lilnas/tdr-bot exec jest --testMatch '**/*.live.test.ts' --runInBand --forceExit src/llm/testing/live/playground-chat.live.test.ts` (nothing written to disk, nothing printed).
Fixture: HYPERS, residentsleeper, gasp (685953810413125686, from fd231f2e), peepoWine (animated), Loading. The test also asserts dictionarySize === 5 and that `emojis` equals analyzeEmojis(reply, keys), i.e. the service reports what the pure analyzer computes — no assertion on counts. Scoped Jest check still 33 suites / 510 tests (live file excluded). Lint: only the 6 baseline dayjs warnings.

Defects:

- not blocking · Analyzer silently drops near-miss emoji tokens like `<:a:name:id>` · apps/tdr-bot/src/emojis/emoji-analysis.ts:46
  gpt-5-mini reply contained `<:a:peepoWine:1266528661318926369>` (extra colon); analysis counted 2 dictionary · 0 hallucinated · 0 unicode · 0 shortcode — the malformed token (which Discord renders as plain text) matched neither CUSTOM_EMOJI_RE (name 'a' < 2 chars) nor SHORTCODE_RE, so it was scored as nothing rather than as a hallucination.

### 2026-10-19 · H1 · changes requested
Changes requested at round 1: 4 comments, sent to R1.

Design review of `docs/features/tdr-bot/designs/playground.html`, round 1:

1. region over <div> "tdr-bot Settings Transcript Reminders Emojis Playground Mod…" in scene "Mobile"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(7) > div:nth-of-type(2)` at fx 0.27, fy 0.00, fw 0.45, fh 0.12
   - **user:** we should fix the mobile top nav, it's broken on here
   - screenshot 1 attached
2. region over <div> "▸ System prompt draft modified Overrides the saved prompt f…" in scene "Mobile"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(7) > div:nth-of-type(2)` at fx 0.28, fy 0.27, fw 0.44, fh 0.13
   - **user:** this is too crowded, we should fix it. too much line wrapping
   - screenshot 2 attached
3. region over <div> "Shortcode Avg cost Avg latency $0.0031 1.1 s $0.0009 0.8 s …" in scene "Eval panel"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(6) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(2)` at fx 0.88, fy 0.64, fw 0.12, fh 0.31
   - **user:** is this scrollable for long tables or something? if it is, we should add some kind of shadow scrim. if not, we should fix it so that it fits all items
   - screenshot 3 attached
4. region over <div> "Running… 12 / 40 Model Replies with ≥1 dictionary emoji Dic…" in scene "Eval panel"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(6) > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(2)` at fx 0.27, fy 0.61, fw 0.73, fh 0.35
   - **user:** we should have mobile designs for this table
   - screenshot 4 attached

### 2026-10-19 · R1 · done
Mockup-only changes. Appbar (shared mixin) now flex-wraps, so all tdr-bot pages regenerated.
Draft summary wraps with hint on its own line on mobile. Desktop eval table keeps overflow-x-auto
with a right-edge gradient scrim; new frame "8 · Eval panel (mobile)" renders results as per-model
cards (implementation should render cards below a breakpoint, table above, scrim on the table).
Not visually verified in a browser; mockups build and mockups:lint pass. Lint/type-check/jest not run (no code touched).

### 2026-10-19 · H1 · changes requested
Changes requested at round 2: 1 comment, sent to R2.

Design review of `docs/features/tdr-bot/designs/playground.html`, round 2:

1. region over <div> "React to a bad pun. Someone lost a ranked match. Console th…" in scene "Eval panel (mobile)"
   - selector: `body > main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(8) > div:nth-of-type(2)` at fx 0.26, fy 0.55, fw 0.44, fh 0.43
   - **user:** these seem very crowded, can we improve this?
   - screenshot 1 attached

### 2026-10-19 · R2 · done
Mockup-only. Mobile eval cards redesigned: header = model + "$cost · N.N s" meta; headline "NN%" (text-xl, bold for best) + "reply with ≥1 dictionary emoji" + thin progress bar; wrapping chips for "N dictionary", "N hallucinated" (text-bad, only if >0), "N unicode" and "N shortcode" (only if >0). Implementation should render cards this way below the breakpoint. Other HTML pages changed only by regenerated shared CSS utilities. mockups build + mockups:lint pass; not visually verified in a browser; lint/type-check/jest not run (no code touched).

### 2026-10-19 · H1 · approved
Approved.

Approved at round 3.

### 2026-10-19 · Phase 1 · review cycle 1
Pass 1 (T3, T2, T5): T2, T3 and T5 implement their task bodies faithfully; the analyzer's rules, tests and the renderer/lookup seam all agree. Only a P2 note on how DiscordContent treats a failed emoji fetch.
Pass 2 (T1): Pass 2 (T1) is mockup-only: Pug sources plus their regenerated HTML, with no application code. Every hunk was read; the generated HTML matches the Pug and every frame, element and convention the task body asked for is present. Two cosmetic notes for the human mockup review: frame 2's label says the textarea is prefilled with the saved prompt but it shows the modified draft, and the Error frame names gpt-5 while GPT-5 mini is selected (the task dictated that string).
Pass 3 (T4, T6): T4 and T6 match their task bodies: the stateless playground service, zod schema, controller error mapping, keys()/prompt override and the live test are correct and tested; module exports and existing getSystemPrompt callers were verified outside the diff. No defects found.
Pass 4 (R1): Pass 4 (R1 commits) is mockup-only: Pug edits for a wrapping appbar, mobile-aware toolbar/eval panel, a new mobile eval frame, and the regenerated HTML/Tailwind output, which matches the Pug. No application code, tests, or Done-means items are in this slice; nothing to fix.
Pass 5 (R2): Pass 5 covers only R2's mockup revision (playground.pug mobile Eval cards plus regenerated design HTML); Pug conditionals and bar widths match the generated output and no application code is in this slice. Nothing to report.
Seams pass: Seams pass: every cross-task type, name and call site agrees (EmojiAnalysis in api.types, keys()/size() on EmojiDictionaryService, getSystemPrompt options, DiscordContent/useEmojiLookup in Transcript, ModelSelect in Settings, Playground module/controller registration, test and live-test imports). No disagreements found.

Notes:
- F1 · P2 · Failed GET /emojis flags every custom emoji as unknown — apps/tdr-bot/src/components/DiscordContent.tsx:60
- F2 · P2 · Desktop eval table scrim is always visible — docs/features/tdr-bot/designs/src/pages/playground.pug:188
- F3 · P2 · Renderer and analyzer classify deleted dictionary emojis differently — apps/tdr-bot/src/components/DiscordContent.tsx:54

### 2026-10-19 · T7 · done
Decisions:
- Thread state is `useState<Turn[]>` driven through the pure `threadReducer(turns, action)` (actions: user / assistant / error / retry / reset) so the page can compute the next turns synchronously and send them in the same tick.
- Failure semantics: on error the composer gets the failed message back (mockup frame 4); `retry` removes only the error turn and re-sends the identical history; sending a *new* message while the last turn is an error replaces the failed user turn + error (so the request never carries the failed message twice). Covered by tests.
- `formatMeta`: cost 4 dp, `< $0.0001` for 0 < cost < 0.0001, `$0.0000` for exactly 0; durations ≥ 1000 ms → `1.8 s`, below → `820 ms`.
- Draft is sent as `systemPromptDraft` only when `draft !== settings.systemPrompt` (`draftOverride`); "Reset to saved" and the "modified" chip key off the same comparison.
- Score chips: MUI `Chip size="small" variant="outlined"` with success/error/warning/default for ok/bad/warn/muted (same convention as `SourceChip`); the hallucinated chip's `title` is the raw tokens joined by spaces.
- A request sequence ref ignores late responses after "Reset conversation", so a reply can't land in an emptied thread. The reset button is disabled when there are no turns (the confirm dialog therefore only ever shows with turns) and while a request is pending.
- The user-bubble author label is a local `AUTHOR = 'paulbeenis420'` constant rather than importing `DEFAULT_PLAYGROUND_AUTHOR` from `src/playground/playground.service.ts`, which would pull Nest/LangChain into the client bundle.
- The Eval panel goes in the `{/* eval */}` slot between the thread and the composer in `page.tsx`; `scoreChips`/`formatMeta` in `conversation.ts` are reusable for its rows.
Scoped Jest check now reports 34 suites / 522 tests. No mockup changes were needed, so no `pnpm mockups` regeneration.

### 2026-10-19 · T8 · done
Decisions:
- The run loop is a pure, tested `runEval(jobs, call, { concurrency, signal, onProgress })` in `eval.ts` (worker pool of 2; abort checked between calls, in-flight calls finish; cells returned in job order, unstarted jobs omitted). `evalJobs(models, prompts)` builds the model×prompt grid grouped by model. Tests cover peak concurrency, job-order results with a thrown call, progress ticks, and abort semantics.
- `summarize`: one row per model in first-appearance order; averages are over successes only and stay 0 when every call failed. `bestDictionaryRate` skips `calls === 0` rows, ties → first, null when nothing qualifies.
- `EvalPanel` calls `ApiClient.playgroundChat` directly (module-level `new ApiClient()` like the hooks) because `useMutation` can't hold two in-flight calls. It owns `running` and reports it via `onRunningChange`, which `page.tsx` folds into `canSend` so the thread's Send is disabled during a run. The thread's pending request disables "Run eval" too (`disabled={pending}`). The page passes `systemPromptDraft={draftOverride(draft, settings.systemPrompt)}` so the eval uses the same "draft only when modified" rule as the thread.
- Cancel keeps the cells that completed before abort, so a partial table is shown after cancelling; results are cleared only by the next run (Reset conversation doesn't touch the panel). An unmount aborts an in-progress run.
- Results table: MUI `Table` in a `TableContainer` (horizontal scroll on narrow screens; no separate mobile card variant), the best row's cells bold, hallucinated count in error colour when > 0, "n failed" as an error Chip beside the model, and a ▸/▾ toggle per row revealing a `Collapse` with each prompt → reply (`DiscordContent`) → meta line (`formatMeta`) → score chips (`scoreChips`); failed cells show "failed: <message>".
- `TONE_COLOR` moved from `page.tsx` into `conversation.ts` (exported) so the thread and eval rows share the chip colour map.
- Estimate label: `~$x for N calls`, 2 dp (4 dp when below $0.01).
- The pre-existing "worker process has failed to exit gracefully" Jest notice is unrelated: it appears without `src/app` in the pattern and not with `src/app` alone.
- No mockup changes were needed, so no `pnpm mockups` regeneration.

### 2026-10-19 · Phase 2 · review cycle 1
Phase 2 is clean: the playground page, thread reducer, eval runner and summary helpers match the task bodies and Done means, the T7/T8 seams (shared conversation.ts exports, EvalPanel props, ApiClient.playgroundChat) agree, and every required test case is present. Two cosmetic notes only.

Notes:
- F4 · P2 · Empty eval column after an early cancel — apps/tdr-bot/src/app/playground/EvalPanel.tsx:464
- F5 · P2 · Retry is not disabled during an eval run — apps/tdr-bot/src/app/playground/page.tsx:440

### 2026-10-19 · Final report
Run complete: all 10 tasks integrated on `feat/tdr-bot-llm-playground` (9ebdc39f..HEAD); H1 approved on round 3. Review cycle 1 for phase 1 and phase 2 ran clean with no blocking findings; the P2 notes below were left unfixed.

Tasks:
- T1 · Mockup: Playground page and rendered emojis in Transcript · done · `57a31bfb`
- H1 · Review the Playground mockup · changes requested twice (rounds 1 and 2), then approved
- T2 · Pure emoji analyzer and tokenizer · done · `20b453d1`
- T3 · Extract `ModelSelect` to `src/components/ModelSelect.tsx` · done · `1d371784`
- T4 · `POST /playground/chat` (stateless, with emoji analysis) · done · `a36f29e7`
- T5 · `<DiscordContent>` renderer, used by the Transcript · done · `c29f71a5`
- T6 · Live OpenAI check of the playground service · done · `724aae79`
- T7 · `/playground` page: model, thread, prompt draft, score lines · done · `066926ea`
- T8 · Eval panel: fixed prompts × models through `/playground/chat` · done · `37bb4c9c`
- R1 · Round 1 · address 4 review comments on playground.html · done · `4b5df917`
- R2 · Round 2 · address 1 review comment on playground.html · done · `13adbaa2`

Deviations:
- T6 needed `--testMatch '**/*.live.test.ts'` because jest.config.js excludes live tests from the default testMatch. The OpenAI key was injected into the child process via dotenvx only; nothing was written to disk.
- The Eval panel (T8) renders only a table, with horizontal scroll on narrow screens. R2's mockup asked for per-model cards below the breakpoint, so the mobile card variant is not implemented.
- T1 and R1/R2 mockups were not checked in a browser; only the build and mockups:lint passed.

Defects and notes, all unfixed:
- T6 · not blocking · the analyzer drops near-miss tokens such as `<:a:name:id>` (extra colon). Discord renders them as plain text, but they are scored as nothing, not as hallucinations. `apps/tdr-bot/src/emojis/emoji-analysis.ts:46`
- F1 · P2 · a failed `GET /emojis` makes every custom emoji render as "Not in the emoji dictionary", because `isLoading` is false after an error. `apps/tdr-bot/src/components/DiscordContent.tsx:60`
- F2 · P2 · the desktop eval table scrim is always visible, including when the table fits without scrolling. `docs/features/tdr-bot/designs/src/pages/playground.pug:188`
- F3 · P2 · the renderer treats deleted dictionary emojis as known (dimmed), but the analyzer counts them as hallucinated. `apps/tdr-bot/src/components/DiscordContent.tsx:54`
- F4 · P2 · an early cancel in the eval panel can leave an empty column. `apps/tdr-bot/src/app/playground/EvalPanel.tsx:464`
- F5 · P2 · Retry is not disabled while an eval run is in progress. `apps/tdr-bot/src/app/playground/page.tsx:440`
- Mockup cosmetic (R1 review): frame 2's label says the textarea is prefilled with the saved prompt, but it shows the modified draft. The Error frame names gpt-5 while GPT-5 mini is selected. The second label was dictated by the task.

Skipped or partial work: none. Every task in the plan was completed and integrated.

Open questions:
- Should the mobile eval cards from R2 be built, or is the table with scroll enough? (see deviations)
- Should F1 and F3 be fixed before the Transcript ships, given that both affect what users see?

### 2026-10-19 · Landed
Squash-merge of `feat/tdr-bot-llm-playground` into `main` as `feat(tdr-bot): add the LLM playground and custom emoji rendering`, authored as Jeremy Asuncion.
