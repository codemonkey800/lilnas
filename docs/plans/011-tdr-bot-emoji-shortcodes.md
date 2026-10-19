---
nexus-plan: 2
title: tdr-bot custom emojis as shortcodes, resolved in code
branch: feat/tdr-bot-emoji-shortcodes
base: main
setup:
  - pnpm install --frozen-lockfile
  - pnpm --filter @lilnas/utils --filter @lilnas/media build
checks:
  - pnpm --filter @lilnas/tdr-bot lint
  - pnpm --filter @lilnas/tdr-bot type-check
  - pnpm --filter @lilnas/tdr-bot exec jest --maxWorkers=2 src/api src/emojis src/utils src/messages src/app src/commands/tldr src/playground src/components src/llm/testing src/reminders
parallel: 3
review: per-phase
commit-style: "conventional with scope, e.g. feat(tdr-bot): …, fix(tdr-bot): …, test(tdr-bot): …"
---

# tdr-bot custom emojis as shortcodes, resolved in code

## Goal
The chat model makes up custom Discord emoji IDs. A playground eval caught it
writing `<:peepoCozy:758403748580589598>` and then `<a:peepoCozy:758…>` for the
real static `peepoCozy` = `781403748580589598`. It kept the real ID's tail and
took the `758` prefix from the prompt's two examples, and the second time it
also flipped the animated flag. Models don't copy 18-digit snowflakes reliably,
so the model must stop writing IDs. The prompt will list emojis by name only
(`":peepoCozy:"`). The model writes `:name:`, and one pure resolver turns that
into the canonical `<a?:name:id>` before every Discord send of model text (chat
replies, `/tldr`, reminders). The resolver also repairs raw tokens the model
copies from history. The playground runs the same resolver and scores the raw
output, so evals measure what ships. Unicode emoji use, deploys and pushes are
out of scope.

## Decisions
- **Prompt lists names only**, `{":name:": description}` with no ID and no `a`
  flag. The examples become `:EZ:` / `:peepoPooPoo:`. This also cuts about
  1–1.5k prompt tokens.
- **One pure resolver** (`resolveEmojis`) in `src/emojis/emoji-analysis.ts`,
  which the Next.js client imports, so it stays free of Nest, Node and
  discord.js. `EmojiDictionaryService.resolve()` wraps it with the live keys,
  and every send site and the playground call that.
- **One row per name, newest snowflake wins.** Case handling (planner): an
  exact name match comes first. If there is none, a case-insensitive match is a
  *repair*, and the newest snowflake wins among case-folded collisions.
  `DIESOFCRINGE` and `DiesOfCringe` are two distinct emojis and both stay in the
  prompt.
- **Raw tokens get repaired by name, then by ID.** The name lookup is in the
  brief. The ID fallback is a planner addition: it covers emojis renamed since
  old history was written.
- **Unknown names are stripped** from what is sent, and the analyzer counts them
  as hallucinated. An unknown digit-first `:12:` is left as plain text, because
  `5Head`/`4Head` are real digit-first names and plain text like `:50:` must
  survive.
- **Chips (planner):** `N dictionary` (ok), `N repaired` (warn, only when >0),
  `N hallucinated` (bad, only when >0; dropped refs), `N unicode` (warn). The
  three emoji buckets are disjoint. The `shortcode` chip, count and eval column
  are removed, because shortcodes are now the expected form.
- **Scope beyond the brief (planner):** `/tldr` and reminders also send model
  text written against the dictionary prompt. They get the resolver too.
  Otherwise they would post literal `:name:` text.
- **Chat history stays raw.** The graph checkpoint stores the model's raw
  output, because the resolver runs at send time. To match, the playground
  keeps each reply's raw text for the history it sends back and displays the
  resolved text.

## Context
- All code is in `apps/tdr-bot`: a NestJS 11 backend and a Next.js 15 + MUI 7
  admin UI in `src/app/`, both in the same package. Run checks from the repo
  root: `pnpm --filter @lilnas/tdr-bot lint` (fix it with `… lint:fix`),
  `… type-check`, and `… exec jest --maxWorkers=2 <paths>`, then read the
  `Tests:` line. This host is the production server, so never use more workers
  and never run the unscoped suite.
- Jest tests live in `__tests__/` beside the source, and only `.ts` files are
  tested. Keep UI logic in `.ts` modules such as `src/app/playground/conversation.ts`.
  Don't edit `src/__tests__/setup.ts`.
- Style: the `src/...` import alias, no semicolons, single quotes, no `any`,
  pino-style `logger.log({ obj }, 'msg')`, `dedent` for prompts.
- Emoji pieces:
  - `emojiKey(row)` (`src/emojis/emoji-key.ts`) gives `<:name:id>` or `<a:name:id>`.
  - `src/emojis/emoji-analysis.ts` has `CUSTOM_EMOJI_RE`, `CUSTOM_EMOJI_KEY_RE`
    (IDs are 17–20 digits, so test fixtures need real-length IDs),
    `SHORTCODE_RE`, `segmentCustomEmojis` (used by
    `src/components/DiscordContent.tsx`; keep it), `analyzeEmojis` and
    `formatEmojiScore`.
  - `EmojiDictionaryService` (`src/emojis/emoji-dictionary.service.ts`,
    exported by `EmojiDictionaryModule`) caches `listActiveDescribed()` rows and
    exposes `promptText()`, `keys()` and `size()`.
  - The prompt section is `formatEmojiDictionary` in `src/utils/prompts.ts`.
- Live dictionary at base: 165 rows, 164 distinct names (`peepoLeave` twice: ids
  `781402364796076034` and `1178865973156139009`), and 163 distinct
  case-insensitively. Digit-first names are `5Head` and `4Head`.
- The resolver API, which every task uses as written:
  ```ts
  export type EmojiFix = 'id' | 'animated' | 'case' | 'name'
  export interface ResolvedEmoji {
    raw: string                 // as written: ':name:' or '<a?:name:id>'
    form: 'shortcode' | 'token'
    name: string                // name as written
    start: number; end: number  // offsets of raw in the input
    key: string | null          // canonical emojiKey sent instead; null = dropped
    status: 'dictionary' | 'repaired' | 'dropped'
    fixes: EmojiFix[]           // [] unless status is 'repaired'
  }
  export interface EmojiResolution { text: string; emojis: ResolvedEmoji[] }
  export function resolveEmojis(text: string, dictionaryKeys: Iterable<string>): EmojiResolution
  ```

## Done means
Implemented as the task says. New behaviour is covered by Jest tests in the
package's style, and they pass under `--maxWorkers=2`. At `base` `56d1c475` the
scoped test check ran 51 suites and 749 tests, all passing. All checks exit 0.
Lint shows no warnings beyond the 6 dayjs `import/no-named-as-default-member`
warnings present at base. No `any` is added. No new dependencies, environment
variables or migrations. `src/emojis/emoji-analysis.ts` imports nothing from
Nest, Node or discord.js. `src/__tests__/setup.ts` and `src/db/schema.ts` are
unchanged. Every new log call uses `(obj, msg)`. Nothing is deployed or pushed.

## Planner notes
- Base measured 2026-10-19 on `main` `56d1c475`:
  - lint: 12 s, 0 errors, 6 dayjs warnings.
  - type-check: clean.
  - scoped jest: 51 suites, 749 tests, about 3.5 s.
- Send sites for model text written against the dictionary prompt:
  - `ResponseService.sendReply` (chat, the only caller is `ChatHandler`).
  - `TldrService.summarize`.
  - `ReminderDeliveryService.compose`.
  - The playground.
  - `KAWAII_PROMPT` is unused legacy.
- `apps/tdr-bot/.env` has no `OPENAI_API_KEY`. Plan 010's live task decrypted
  `.env.prod` into the child process with dotenvx; T7 reuses that command.
- `nexus_run_create` from a planner ignores config overrides. Every task
  carries `model: frontier`. Effort **high** must be set on the run config
  before Start.
- The dev bot runs from the main checkout's Docker dev compose, not from a run
  worktree. The OpenAI boundary is covered by the live playground test (T7).

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-10-19 · T1 · done
Implemented exactly the API in Context; analyzeEmojis, formatEmojiScore,
EmojiAnalysis and segmentCustomEmojis are untouched. Module still imports
nothing (pure). Decisions worth knowing:
- Code detection: fences are ```…``` (lazy, multi-line); an unterminated
  fence is treated as prose. Inline spans are `…` with no newline inside.
- Whitespace after a drop: the surrounding run of spaces/tabs collapses to
  one space, which is also trimmed at the start of any line (not just the
  start of the text) and before a newline / end of text. A single space is
  inserted only when whitespace was actually removed, so '(:nope:)' → '()'.
- byId keeps the first key seen for an id (ids are unique in practice);
  byName/byLower keep the largest BigInt(id).
- Token repair via byName falls through to byLower in the same branch, so a
  case-and-id mismatch yields fixes ['case','id'] (+ 'animated').
- A non-animated token for an animated dictionary entry (same name+id) is
  'repaired' with fixes ['animated'], not 'dictionary' — byKey is exact.

### 2026-10-19 · T2 · done
keys() now returns canonical '<a?:name:id>' tokens (prompt order) while the
prompt JSON keys are ':name:'; the two lists line up index-for-index.
resolve(text) === resolveEmojis(text, keys()) on the cached tokens.
The prompt text deliberately avoids the literal '<:' (it says "Discord's
angle-bracket name-and-id format") so the no-'<:' assertion holds.
Untouched old-format fixtures that still use '<:name:id>' keys as
formatEmojiDictionary input: src/llm/testing/live/playground-chat.live.test.ts
(live-only, skipped without credentials) — a later task that adjusts the
live test may want to switch it to ':name:' keys. playground.service.ts
still calls analyzeEmojis(output, dictionary.keys()), which keeps working
since keys() are still tokens.

### 2026-10-19 · T4 · done
sendReply order is now: resolve → sanitize → length check → shorten → resolve → length check → truncate.
The error fallback string still hard-codes '<:Sadge:781403152258826281>' and is not resolved (it's a literal, not model output).
LLMOrchestrationService and checkpointed history are untouched, as specified.
Any test that builds ResponseService via createTestingModule must now provide EmojiDictionaryService; only response-service.test.ts does today.

### 2026-10-19 · T5 · done
TldrService now takes EmojiDictionaryService as its third constructor arg
(CommandsModule imports EmojiDictionaryModule). In summarize, each model
message is resolved via this.emojis.resolve(message.trim()).text before
linkifyCitations/reflowForDiscord, so chunk lengths reflect the final text.
ReminderDeliveryService.compose resolves message.content with the injected
emojiDictionary before withMentions; toPayload truncation sees the
resolved text (existing truncation test still passes). Both test files stub
resolve with the real resolveEmojis against a single key
'<:EZ:123456789012345678>' (real-length snowflake); the reminder stub's
promptText fixture now uses a ':EZ:' key. New tests: /tldr shortcode →
token and unknown shortcode stripped; reminder default + search deliveries
send the resolved token with mentions still prefixed. Nothing deployed or
pushed.

### 2026-10-19 · T3 · done
- EmojiAnalysis is now { counts: {dictionary, repaired, hallucinated, unicode},
  dictionary/repaired/hallucinated: ResolvedEmoji[], unicode: string[] }.
  HallucinationReason, SHORTCODE_RE, the shortcode count/list and the old
  dictionary parser are gone; segmentCustomEmojis/CustomEmojiRef remain.
- Bucket semantics follow the T1 resolver as written: an exact-name
  shortcode (':peepoCozy:', the incident) has status 'dictionary', so it
  counts as dictionary, not repaired. Repaired = wrong case/id/animated/name
  (tokens) or wrong-case shortcodes. The task text said "incident tokens
  counted as repaired"; the tests assert the resolver's actual behaviour
  (wrong-id/case/flag tokens repaired) rather than changing the resolver.
- Unicode is counted in prose runs outside code spans/fences and outside
  every resolved ref's [start,end), scanned per run so a sequence never
  spans a ref. Unresolved ':50:'-style text is still scanned as prose.
- playground-chat.live.test.ts needed no edit: it only calls
  analyzeEmojis/formatEmojiScore and compares result.emojis to a fresh
  analysis of result.reply, which still compiles and holds.
- playground.service.ts still analyzes result.output (the raw reply) and
  does not send resolved text; that is presumably T2's job, untouched here.

### 2026-10-19 · T6 · done
PlaygroundChatResponse now has `raw` (model output as written) and `reply`
(resolved via EmojiDictionaryService.resolve). Any stub of
EmojiDictionaryService used with PlaygroundService must now provide
`resolve` (the service test and live test do; eval.test.ts fixture gained
`raw`). Client assistant turns carry `raw`; toRequestMessages sends `raw`
for assistant turns so history matches production's checkpointed raw output.
Service test scripts 'hi :EZ: <a:pog:…99> :fake: 😀' → counts
dictionary 1 / repaired 1 (id fix) / hallucinated 1 / unicode 1; note the
resolver drops the unknown shortcode together with its surrounding
whitespace, so the resolved reply has a single space there. Live test not
run (needs credentials); it compiles and lints.

### 2026-10-19 · T7 · done
Live test run twice (not 3×); both runs PASS for gpt-4-turbo and gpt-5-mini.
Cost ≈ $0.0065 (gpt-4-turbo) + $0.0025 (gpt-5-mini) per run.
All emoji refs in all four replies were ':name:' shortcodes resolving to
'dictionary' status; zero repaired, zero hallucinated, zero raw tokens,
nothing dropped. peepoWine resolved to the animated '<a:…>' form.
gpt-5-mini added Unicode ✨/☺️ in one run (counted as unicode, passed through).
Checks: lint 0 errors / 6 base dayjs warnings; type-check exit 0;
scoped jest 51 suites / 778 tests pass.
No code changed, nothing committed; temp files removed, tree clean.
Tip for whoever reruns: the test's '[live] …' console lines are silenced by
src/__tests__/setup.ts unless DEBUG is set — pass DEBUG=1 to see them.

No commits: nothing to integrate.

### 2026-10-19 · Phase 1 · review cycle 1
Pass 1 (T1, T2, T4, T5): Slice T1/T2/T4/T5 is clean: the resolver's lookup, fix ordering, whitespace handling and offsets are correct, the service's newest-per-name selection lines prompt keys up with tokens, and every send path resolves before its length/formatting step with the required tests present. The one seam T2 flagged (the live playground test feeding token keys to formatEmojiDictionary) is already switched to ':name:' keys on the merged branch.
Pass 2 (T3, T6): Pass 2 (T3, T6) is clean: the analyzer is a faithful status filter over the resolver with per-run unicode counting, the playground returns raw plus resolved reply and scores raw, client turns carry raw into history, and the required tests are present and pass. One note for a human only.
Seams pass: Seams pass: every consumer of the T1 resolver API (T2 service wrapper, T3 analyzer/chips/eval, T4 reply path, T5 tldr/reminders, T6 playground raw/reply) uses the same names, statuses and EmojiAnalysis shape, the removed HallucinationReason/counts.shortcode have no remaining references, and all three consuming modules import EmojiDictionaryModule. No disagreements found.

Notes:
- F1 · P2 · T3 note misreads the incident; analyzer test covers it only by category — apps/tdr-bot/src/emojis/__tests__/emoji-analysis.test.ts:123

### 2026-10-19 · Final report

Outcome: all seven tasks done and integrated on `feat/tdr-bot-emoji-shortcodes`; review cycle 1 clean apart from one unfixed P2 note.

Tasks and commits (squashed onto the run branch):
- T1 · resolveEmojis pure resolver · `10bae3cc`
- T2 · name-only prompt dictionary and EmojiDictionaryService.resolve · `89dfc046`
- T3 · analyzer on the resolver, playground chips, eval table · `c8b3bf90`
- T4 · resolve chat replies before the Discord send · `aa644206`
- T5 · resolve /tldr and reminder messages · `81aaf972`
- T6 · playground ships the resolved reply and scores the raw one · `63047fd3`
- T7 · live OpenAI check of the shortcode flow · no code commit; its plan-log commit is `0014612d`

Deviations:
- T7 ran the live test twice, not three times, against gpt-4-turbo and gpt-5-mini; both passed. Cost about $0.0065 and $0.0025 per run.
- T3 classified exact-name shortcodes such as ':peepoCozy:' as dictionary, not repaired. The task text said the incident tokens counted as repaired. The tests follow the resolver as written. See F1.
- T6's live test was not run in its own task (no credentials there). T7 covered it.

Skipped or partial work:
- Nothing deployed or pushed.
- The live test needs OpenAI credentials and is skipped without them. T7 is the only live run.

Review:
- Cycle 1, three passes, outcome clean with 0 blocking findings.
- F1 (P2, unfixed): the T3 note calls ':peepoCozy:' the incident. The incident was the wrong-id tokens '<:peepoCozy:758…>' and '<a:peepoCozy:758…>'. The resolver tests at lines 302–318 cover those tokens. The analyzer test at line 123 covers wrong-id and wrong-flag tokens by category only. Behaviour is covered; the wording is wrong.

Defects reported during the run: none beyond the review note above.

Open questions:
- Should the analyzer test name the literal incident tokens, as F1 suggests?
- T2 noted that the live playground test used to feed token keys to formatEmojiDictionary. Review confirmed it now uses ':name:' keys.
- Run DEBUG=1 when rerunning the live test to see the '[live] …' console lines; setup.ts silences them otherwise.

### 2026-10-19 · Landed
Squash-merge of `feat/tdr-bot-emoji-shortcodes` into `main` as `feat(tdr-bot): resolve emoji shortcodes in code`, authored as Jeremy Asuncion.
