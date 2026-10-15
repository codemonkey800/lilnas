---
nexus-plan: 2
title: tdr-bot /tldr command
branch: feat/tdr-bot-tldr-command
base: main
setup:
  - pnpm install --frozen-lockfile
  - pnpm --filter @lilnas/utils --filter @lilnas/media build
checks:
  - pnpm --filter @lilnas/tdr-bot lint
  - pnpm --filter @lilnas/tdr-bot type-check
  - pnpm --filter @lilnas/tdr-bot exec jest --maxWorkers=2
parallel: 2
review: per-phase
commit-style: "conventional with scope, e.g. feat(tdr-bot): …, fix(tdr-bot): …, test(tdr-bot): …"
---

# tdr-bot /tldr command

## Goal
Add a `/tldr` slash command to `apps/tdr-bot` that catches a person up on a
Discord conversation. It reads the messages in the current channel (or a chosen
one) and the threads under it, back to a point the user picks (`since:2h`,
`since:8:30pm`, `since:yesterday`) or, by default, back to the user's own last
message there, and posts a summary in TDR bot's voice: the gist, the topics,
open questions, anything the requester was asked, with jump links to the key
messages. `from:@user` narrows the summary to what one person said;
`question:"what do we have tickets for?"` answers a question from the same
window instead of summarizing it. One command, no new tables, no new settings.

## Decisions
- **Slash command only.** No LangGraph skill and no message context-menu
  command in v1; the structured options (since / from / channel / question)
  are the point. Ruled out: `@tdr-bot what did I miss`.
- **Window is bounded by messages, not time.** At most 1,000 messages per
  summary (channel plus its threads); `since` has no maximum. A window larger
  than that keeps the newest 1,000 and the reply says it was clipped. Ruled
  out: a 7-day cap and a `last:N` option.
- **Default window is "since your last message here."** With no `since`, the
  window starts just after the requester's most recent message in the target
  channel (looked for within the 1,000 newest). If they have none, the newest
  100 messages.
- **Scope is the channel plus its threads.** Active threads and public
  archived threads under the channel with activity after `since` are included,
  each as its own section. Run inside a thread, `/tldr` covers only that thread.
  A `channel` option targets another text channel or thread. Ruled out:
  whole-server by default.
- **Reader permissions are enforced.** The requester must be able to view the
  target channel and read its history (and each thread, so private threads
  they are not in are skipped); otherwise an ephemeral refusal. DMs are refused.
- **Replies are public and in persona.** The summary is a normal (non-ephemeral)
  reply in the channel, written by the `chat` model role under the configured
  system prompt. Input errors (bad `since`, no access, nothing to summarize)
  are ephemeral. Ruled out: ephemeral summaries, DMs, a neutral voice.
- **`chat` role, cost acknowledged.** The chat model today is `gpt-4-turbo`
  ($10/1M input); a full 1,000-message window is roughly 40–50k tokens, so
  about $0.50 per summary. Smaller windows are proportionally cheaper and the
  Settings page can switch the chat model. One `/tldr` in flight per user.
- **Citations are indices, not raw links.** Each transcript line carries `[n]`;
  the model cites `[n]` and a post-processor swaps them for masked message
  links, so the model never has to reproduce snowflakes.
- **Previous `/tldr` output is excluded** from the window (the bot's own
  interaction replies), so summaries don't summarize summaries. Other bot
  messages stay, tagged `[bot]`.
- **Times use `REMINDER_TIMEZONE`** (`America/Los_Angeles`) for parsing
  `since` and for timestamps shown to the model and the user.

## Context
- pnpm + Turbo monorepo; this work is confined to `apps/tdr-bot` (NestJS 11
  Discord bot via necord 6.11 + discord.js 14.23). Checks, from the repo root:
  `pnpm --filter @lilnas/tdr-bot lint` (eslint + prettier; fix with `… lint:fix`),
  `… type-check`, `… exec jest --maxWorkers=2` (never more workers: the host is
  the production server). Read the `Tests:` summary line; base is 84 suites /
  1432 tests passing, lint 0 errors with 6 pre-existing dayjs
  `import/no-named-as-default-member` warnings.
- Jest: `apps/tdr-bot/jest.config.js`; tests live in `__tests__/` beside the
  source, only `.ts` files. `src/__tests__/setup.ts` installs global mocks for
  discord.js (only `Client`, `Collection`, `ChannelType` {GuildText, DM,
  GuildVoice}, `EmbedBuilder`…), necord (only `Context`, `On`, `SlashCommand`,
  `Options`, `StringOption`…), minio, fs-extra, `nanoid` (always
  `'test-id-123'`). Do not edit `setup.ts`: when a file under test needs more
  discord.js exports (`MessageFlags`, `PermissionFlagsBits`, `SnowflakeUtil`,
  more `ChannelType`s) or necord decorators (`UserOption`, `ChannelOption`),
  add a per-test `jest.mock('discord.js', …)` / `jest.mock('necord', …)` as
  `src/commands/__tests__/download-command.service.test.ts` and
  `command.service.test.ts` do. Fake Discord objects are plain objects cast
  `as unknown as X`; `createMockMetricsService` is in `src/__tests__/test-utils.ts`.
- Style: imports use the `src/...` alias; no semicolons, single quotes, trailing
  commas, `arrowParens: avoid`; no `any`; pino-style logging
  `logger.log({ obj }, 'msg')`; `dedent` for multi-line prompt strings.
- Slash commands: `src/commands/command.service.ts` and
  `download-command.service.ts` (`@SlashCommand`, `@Options()` DTO classes with
  `@StringOption` etc., `interaction.deferReply` / `editReply` / `followUp`,
  `MessageFlags.Ephemeral` for private replies), registered in
  `src/commands/commands.module.ts`. necord provides the discord.js `Client`
  for injection anywhere (see `src/messages/handlers/chat.handler.ts`).
  `TdrBotMetricsService.commandExecuted(name)` counts commands.
- LLM calls: `LlmClient` (`src/llm/client/llm-client.ts`, exported by
  `src/llm/llm-core.module.ts`): `llm.call({ operation, role: 'chat' |
  'reasoning', messages, overrides: { timeoutMs, maxTokens } })` returns
  `{ output: string, message }`. The persona system prompt is
  `PromptService.getSystemPrompt()` (`src/messages/prompts/prompt.service.ts`,
  exported by `PromptsModule`). Calls are audited with the active request
  context: wrap work in `runWithRequestContext({ requestId, userId, channelId,
  guildId, skill }, fn)` from `src/llm/observability/request-context.ts` as
  `src/messages/messages.service.ts` does. Tests script calls by operation name
  with `FakeLlmClient` (`src/llm/testing/fake-llm-client.ts`).
- Constants: `DISCORD_MAX_MESSAGE_LENGTH` (2000) in `src/constants/chat.ts`;
  `REMINDER_TIMEZONE` in `src/reminders/reminder.constants.ts`. dayjs 1.11 with
  its bundled `utc`, `timezone`, `customParseFormat` plugins is a dependency;
  `src/llm/skills/reminder/skill.ts` shows the `dayjs.extend` + `.tz()` usage.
- Discord message links are `https://discord.com/channels/<guildId>/<channelId>/<messageId>`
  (threads use the thread id as channelId). Masked links `[text](<url>)` render
  without an embed preview.

## Done means
Implemented as specified; new behaviour covered by Jest tests in the package's
style, passing under `--maxWorkers=2` (base as of `main` 77ea74d7: 84 suites,
1432 tests); the three checks exit 0 and lint adds no warnings over the 6 at
base; no `any` added; `src/__tests__/setup.ts` unchanged; no new environment
variables; every new log call uses `(obj, msg)`; existing slash commands, chat,
math, media and reminder behaviour unchanged; `apps/tdr-bot/README.md` documents
`/tldr`.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report. -->

### 2026-10-14 · T1 · done
- `types.ts` matches the spec exactly. `TldrError` sets `name = 'TldrError'`, and its `message` defaults to the code.
- Decision on the spec conflict: it says a year-less date after now rolls back a year, and also that `10/20` gives `future_since`. I followed the roll-back rule, so `10/20` on 2026-10-14 resolves to 2025-10-20. Tests cover `future_since` with `10/20/2026`, `2026-10-20` and `oct 20 2026`. Later tasks need no change; only a year-less future date behaves differently from the spec's example.
- `tomorrow` is recognised on purpose so it gives `future_since` and not `bad_since`.
- Bare numbers like `8` are `bad_since`; a clock time needs `:mm` or am/pm. `10/13/26` is read as 2026.
- Durations are plain ms subtraction from `now`, so they are not DST-aware.
- `since.ts` and the test use `import dayjs, { extend } from 'dayjs'` with `extend(...)` to avoid the `import/no-named-as-default-member` warning.
- `apps/tdr-bot/README.md` is untouched. The `/tldr` docs are still owed; the task that registers the command should add them.
