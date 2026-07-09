---
title: "feat: tdr-code Configurable Agent System Prompt"
type: feat
status: active
date: 2026-07-05
deepened: 2026-07-05
---

# feat: tdr-code Configurable Agent System Prompt

## Overview

tdr-code spawns a Claude Code agent subprocess (via `@agentclientprotocol/claude-agent-acp`, an Agent Client Protocol bridge) per Discord-channel session. Today every session gets that bridge's default `claude_code` preset system prompt with no tdr-code-specific instructions layered in.

This plan adds a **configurable system prompt**: a hardcoded base prompt (in code, always applied) combined with an operator-editable custom prompt (a new textarea on the existing global config console page, persisted like the app's other runtime settings). The base prompt's job is narrow but concrete — tell the agent to use the git-identity wrapper transparently instead of bypassing it, and never emit Markdown tables in Discord responses, since Discord can't render them.

The mechanism is an undocumented-but-confirmed extension point: the vendored ACP bridge reads `_meta.systemPrompt` off the `session/new` and `session/load` requests and, when given `{ append: "..." }`, appends that text after Claude Code's own built-in default prompt rather than replacing it. This plan wires tdr-code's existing config chain (`config` table → repo → service/DTO/controller → `SessionManagerService`'s hot-reloadable mutable fields) to build and send that combined string.

---

## Problem Frame

`SessionManagerService` already has five operator-editable runtime settings (`cwd`, `claudeCommand`, `claudeArgs`, `idleTimeoutSec`, `maxConcurrentSessions`) that flow from a single-row SQLite `config` table through a console UI, with documented per-setting apply-timing (see `docs/plans/2026-07-01-001-feat-tdr-code-phase-c-config-git-identity-plan.md`, which established this chain). None of them touch what the spawned agent is actually told to do — every session runs on the bridge's stock system prompt.

Two concrete behaviors are currently unenforced by any instruction to the agent:
- **Git identity bypass risk.** `apps/tdr-code/scripts/git` transparently applies per-turn author/committer identity and SSH commit signing by shadowing `git` on the spawned process's `PATH`. The same environment also exports `TDR_REAL_GIT` (the wrapper's own real-binary path, needed so it can delegate) — which is also the wrapper's own documented bypass surface (`apps/tdr-code/scripts/git:26-37`: *"this script's own `$TDR_REAL_GIT` is exported into the agent's env ... so `"$TDR_REAL_GIT" commit ...` bypasses it entirely"*). Nothing currently tells the agent not to reach for it.
- **Discord can't render Markdown tables.** Nothing currently tells the agent to avoid emitting them, so it may produce raw pipe-and-dash text that renders as garbage in a channel.

Both are addressable with system-prompt instructions, but there's no mechanism to compose or deliver one today.

---

## Requirements Trace

- R1. A textarea on the existing console config page (`apps/tdr-code/src/app/config/page.tsx`) lets an operator enter free-form custom system-prompt text, saved via the existing config PUT flow.
- R2. A base system prompt is hardcoded in tdr-code's source — not stored in the DB, not editable via the UI — and always applies.
- R3. The system prompt actually sent to the spawned agent is the base prompt combined with the operator's custom prompt.
- R4. The base prompt instructs the agent to use the git wrapper (`apps/tdr-code/scripts/git`) normally and never bypass it (specifically: never invoke `$TDR_REAL_GIT` directly or write to `.git/objects`/`.git/refs` directly).
- R5. The base prompt instructs the agent to never emit Markdown tables in chat responses, since Discord cannot render them.
- R6. The combined prompt applies to every **new** session and every **reactivated** (resumed) session — not just freshly created ones.
- R7. The feature follows this app's existing "new sessions only" config apply-timing convention: saving a new prompt does not retroactively affect already-running channel sessions.

---

## Scope Boundaries

- No server-side enforcement of the no-Markdown-tables rule (R5) — e.g. no stripping/rewriting of agent output before posting to Discord. Like R4's git-wrapper instruction, this is delivered purely as a system-prompt nudge; unlike R4, R5 has no underlying technical control behind it at all (R4 at least has the wrapper script itself doing real work — R5's *only* mechanism is the prompt instruction). Both share this feature area's established posture: a UX control, not a containment boundary (`apps/tdr-code/scripts/git:26-37`).
- No mechanism to push an updated prompt into an already-running Discord-channel session. Existing sessions keep whatever prompt was live when they were created/reactivated, identical to how `cwd`/`claudeCommand`/`claudeArgs` already behave.
- No handling of interaction between the new prompt and any project `CLAUDE.md` that the Claude Agent SDK may auto-load from the configured `cwd` (the vendored bridge always passes `settingSources: ["user", "project", "local"]`, which is outside tdr-code's control). Documented as an accepted non-goal, not silently ignored — see Risks & Dependencies.
- No runtime/integration proof that the vendored `@agentclientprotocol/claude-agent-acp` package actually honors `_meta.systemPrompt.append` — pinning its version (U5) stops the bridge from silently *changing* underneath this feature, but doesn't prove the pinned version *acts* on the extension at all. Unit tests verify tdr-code *sends* the right shape; whether the bridge *acts* on it is a deferred, manually-verified concern (see Documentation / Operational Notes).
- No character limit tied to Claude's context window. The cap this plan adds exists to bound DB/log growth, not to protect model context budget.

### Deferred to Follow-Up Work

Version-pinning the npx dependency was originally listed here as a "fast-follow," but two independent review passes (security and scope review) both flagged that framing as self-undermining — calling something both urgent/safety-relevant and deferred is a contradiction, not a scope decision, especially given the environment it runs in already holds git-write and SSH-signing capability. It is now U5 in this plan instead of a follow-up (see Implementation Units). What remains genuinely deferred:

- **A scheduled canary session** (e.g. a daily cron job, using the `@nestjs/schedule` `ScheduleModule` already registered in `bot.module.ts`) that asks a live session a deterministic question whose correct answer depends on the base prompt having landed, and logs a durable event on mismatch. This is the only check that can prove the bridge *acted* on `_meta.systemPrompt`, not just that tdr-code sent it (U2's event-logging proves the latter — the two are not equivalent, see Risks & Dependencies). Genuinely deferred, unlike the version pin, because it requires new scheduling infrastructure this plan doesn't otherwise need.
- Consolidating `apps/tdr-code/src/agent/__tests__/session-manager.service.test.ts` into its `.spec.ts` sibling. Both files are live (verified against `jest.config.js`'s backend-project `testMatch`, not dead code as an earlier pass on this plan incorrectly assumed) and cover overlapping ground on the same class — ordinary test-hygiene cleanup this plan happened to notice, not a safety-relevant item like the one above.

---

## Context & Research

### Relevant Code and Patterns

- `apps/tdr-code/src/agent/session-manager.service.ts` — five mutable private fields (`claudeCommand`, `claudeCwd`, `claudeArgs`, `idleTimeoutSec`, `maxConcurrentSessions`) set in the constructor from `getConfig(db)` and wholesale-reassigned by `rereadConfig()` (~line 151), which `apps/tdr-code/src/commands/command-poller.service.ts` invokes when it dequeues a `reread_config` command. The two ACP session-creation call sites are `createSession()`'s `connection.newSession({ cwd, mcpServers: [] })` (~line 842) and `reactivateSession()`'s `connection.loadSession({ sessionId, cwd, mcpServers: [] })` (~line 635) — neither currently sends `_meta`.
- `apps/tdr-code/src/db/schema.ts` (~line 517) — the single-row `config` table (`id` CHECK-constrained to `1`). Text columns like `cwd`/`claudeCommand` are `notNull()` with no CHECK; only the two numeric fields have CHECK constraints.
- `apps/tdr-code/src/db/config.repo.ts` — `getOrSeedConfig` (idempotent env-seeded insert, `BEGIN IMMEDIATE`, **main-process only**), `updateConfig` (`BEGIN IMMEDIATE` patch+return), `ConfigPatch = Partial<Omit<ConfigRow, 'id' | 'updatedAt'>>` (structural — a new column is automatically assignable here with no repo code change).
- `apps/tdr-code/src/console/config.service.ts` / `config.dto.ts` / `config.controller.ts` — the validated write path. `config.service.ts`'s `updateConfig()` hand-lists every field when building its `ConfigPatch` and in `toDto()` (no spread) — both spots need the new field added explicitly. `config.dto.ts` declares `UpdateConfigBodySchema` and `ConfigResponseSchema` separately (not derived from each other); `claudeArgs`'s validation (`.max(64, ...)`, NUL-byte rejection via `.refine`) is the closest precedent for validating a new operator-editable, protocol-boundary-crossing text field.
- `apps/tdr-code/src/app/config/page.tsx` — hand-rolled Tailwind React form, `useQuery`/`useMutation` (TanStack Query), a `FieldLabel` helper rendering `label` + `effectLabel` ("takes effect: ..."). The existing `claudeArgsJson` field (a raw `<textarea rows={2}>` with local string state and inline validation-error display) is the direct template for the new field, minus the JSON-parsing step.
- `apps/tdr-bot/src/message-handler/services/prompts/prompt.constants.ts` — this monorepo's existing convention for hardcoded prompt/instruction text: a dedicated constants module colocated with the consuming service, one `*.constants.ts` (or `*.prompts.ts`) file per feature area. tdr-code has no LangChain dependency and no `dedent` package, so the new constant is a plain exported `string` built from a template literal, not a `SystemMessage`/`dedent` call.
- ACP mechanism (verified by reading the vendored `@agentclientprotocol/claude-agent-acp@0.55.0` package, resolved dynamically via `npx` and not committed to this repo): its shared `getOrCreateSession()` handler — used by both `newSession` and `loadSession` — reads `params._meta?.systemPrompt`. A **string** value fully replaces the Claude Agent SDK's default `claude_code` preset prompt; an **object** like `{ append: "..." }` is forwarded as `{ type: "preset", preset: "claude_code", append: "..." }`, which preserves the default preset and appends the given text after it. Both `NewSessionRequest` and `LoadSessionRequest` (from `@agentclientprotocol/sdk`) already declare an open `_meta?: { [key: string]: unknown } | null` field, so no SDK/type changes are needed — this is purely an application-level wiring gap.

### Institutional Learnings

- `docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md` — every `info`/`warn`/`error` log needs a registered `LOG_EVENTS` slug and must never interpolate a raw error message/stack directly. The existing `configUpdated` and `configRereadApplied` events already exist and just need the new field folded into their (already-freeform) context — no new event slug is needed.
- `docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md` — confirmed not newly relevant: `config.repo.ts`'s `updateConfig` is a single `UPDATE ... RETURNING` (no read-then-conditionally-write), already wrapped in `BEGIN IMMEDIATE`. Adding a column changes nothing about this shape.
- No `docs/solutions/` entries exist yet for the config chain itself, ACP/`_meta` usage, zod DTO conventions, or TanStack Query form patterns — this plan is establishing precedent, not following a documented one, in those areas.

---

## Key Technical Decisions

- **Send `_meta: { systemPrompt: { append: combined } }`, never a bare string.** A string would silently discard Claude Code's own built-in system prompt (tool-use behavior, etc.); `append` layers tdr-code's instructions on top of it instead.
- **The mechanism splits into two independently-graded risks, not one undifferentiated "read out of vendor source" guess.** Verified directly against the cached packages: `{ append, excludeDynamicSections }` is a documented, versioned field on `@anthropic-ai/claude-agent-sdk`'s own public `Options.systemPrompt` type (JSDoc'd, with a worked example — "Default with additions" — matching this exact use case almost verbatim) — comparatively durable, SDK-contractual. The bridge (`@agentclientprotocol/claude-agent-acp`) does essentially nothing to that shape; it only invents the *transport*: reading it off an ACP-level `_meta.systemPrompt` key, which does not appear in the ACP protocol schema itself and is this one bridge's own undocumented convention — this key name, not the shape, is the genuinely fragile part. Risks & Dependencies carries these as two separate rows for exactly this reason.
- **Checked for a more official delivery path before committing to `_meta.systemPrompt`; none exists today.** Three alternatives were checked directly against the vendored source, not assumed: (1) `_meta.claudeCode.options` — a second, more general pass-through the same handler supports, spread into the SDK options *after* the computed `systemPrompt`, which is `_meta.systemPrompt`'s dedicated, `append`-aware shorthand — the raw pass-through was rejected because this plan would otherwise have to reimplement the preset/append merging itself, and it's noted below as a collision hazard, not a viable alternative; (2) the bridge's settings-file mechanism (`SettingsManager`/`resolveSettings`, backing `.claude/settings.json` et al.) — confirmed the SDK's `Settings` type has no `systemPrompt` field anywhere in that surface; (3) environment variables — the only prompt-adjacent env vars in the bridge are `MAX_THINKING_TOKENS` and `CLAUDE_MODEL_CONFIG`, neither prompt-related. `_meta.systemPrompt` is the only session-scoped prompt-configuration surface the bridge exposes today.
- **Collision hazard, not just a risk of silence:** `_meta.claudeCode.options` (see above) is spread into the SDK options object *after* the computed `systemPrompt`. If anything ever sets `_meta.claudeCode.options.systemPrompt` directly (a future feature, a manual debugging `_meta` override), it would silently overwrite this feature's `append`-based value with no `append` semantics and no error. Nothing in this plan uses `claudeCode.options`, but anything that does in the future must know this ordering exists — flagged in Risks & Dependencies so it isn't rediscovered the hard way.
- **Combination order: base, then a blank line, then custom — and omit the custom segment entirely when it's blank.** Concretely: `custom.trim() ? \`${BASE_SYSTEM_PROMPT}\n\n${custom.trim()}\` : BASE_SYSTEM_PROMPT`. Putting custom text last makes it the most-recent (highest-weighted) instruction, so an operator's own prompt-engineering can add nuance without a trailing blank-line artifact when nothing custom is set. This does mean an operator *could* write text that contradicts the base rules (e.g. "feel free to use tables") — accepted as an inherent limit of prompt-based instruction, not something this plan tries to prevent. More broadly, `customSystemPrompt` is a prompt-injection-adjacent surface, not just a base-rule-contradiction one: nothing in this plan's validation (length cap, NUL-byte rejection) inspects content for text engineered to make the agent disregard its instructions generally. The only real mitigation is that writing to this field already requires the same config-write access as every other operator-editable setting — the same trust boundary the other five fields already rely on, not a new one this field introduces.
- **New column `custom_system_prompt` (`customSystemPrompt`), `text().notNull().default('')`.** Matches the existing NOT-NULL text-column convention (`cwd`, `claudeCommand`) rather than introducing the only nullable column in this table — "unset" and "empty string" are the same state, which keeps combination logic simple (see decision above) and avoids a type-guard-on-`null` concern. Unlike the other four fields, it is **not** env-seedable — there's no sensible env-var default for free-form prompt text, so `getOrSeedConfig` seeds it as a literal `''`.
- **No storage-time trimming or whitespace-only rejection.** Unlike `claudeCommand` (which rejects whitespace-only as invalid), an all-whitespace or empty custom prompt is a legitimate "no customization" state here. The DTO stores exactly what the operator typed; trimming happens only inside the combination helper at prompt-build time, so the console form always echoes back precisely what was saved.
- **Validation mirrors `claudeArgs`'s existing precedent**: reject embedded NUL bytes (same protocol-boundary-crossing-text hazard as `claudeArgs`) and cap length at 20,000 characters via a zod `.max()`. The cap exists to bound DB-row and log-line growth, not to protect Claude's context window.
- **Base prompt lives in a new `apps/tdr-code/src/agent/system-prompt.constants.ts` module**, colocated with `session-manager.service.ts`, mirroring tdr-bot's `*/prompts/*.constants.ts` colocation convention (adapted: plain `string`, no `dedent`/LangChain dependency).
- **Both ACP call sites get the same treatment.** `createSession()`'s `newSession` and `reactivateSession()`'s `loadSession` both need `_meta.systemPrompt` — missing either one would mean fresh sessions and resumed sessions silently diverge in behavior.
- **A `rereadConfig()` landing mid-session-creation is last-value-wins, not snapshotted — accepted, not fixed.** `buildSystemPrompt()` reads the live `this.customSystemPrompt` field at the moment `newSession`/`loadSession` actually fires, which sits behind prior awaits (`connection.initialize()`, and for reactivation, a `loadSession` call racing a 30-second timeout). A `rereadConfig()` landing in that window changes which prompt version a still-in-flight session creation ends up using. This is the same pre-existing behavior the four sibling fields already have (`claudeCwd` is read the same way, at the same points), so this plan doesn't add a new race — it just inherits one. No snapshotting is added; a session creation attempt that straddles a config change may use either the old or new prompt depending on exact timing, and that's accepted as consistent with the "new sessions only" apply-timing convention rather than a stronger per-attempt guarantee.
- **Log the new field in full, unredacted**, in both `configUpdated` (`config.service.ts`) and `configRereadApplied` (`session-manager.service.ts`) — it's operator-authored configuration text, not a secret like the git-identity private key. State this explicitly as an inline code comment at both call sites, matching this codebase's convention of annotating sensitivity decisions where they're made (e.g. `config.controller.ts:26`, `git-identity.controller.ts:33-34`).
- **New tests land only in `session-manager.service.spec.ts`, not its `session-manager.service.test.ts` sibling.** Both files are live — tdr-code's Jest config defines three projects, and the backend project's `testMatch` (`['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts', ...]`) matches any `.ts` file under a `__tests__` directory, so `.test.ts` runs under `pnpm test` just like `.spec.ts` does (verified directly against `jest.config.js`, correcting an earlier research claim that it was unmatched dead code). `.test.ts` was checked and contains no assertions on `newSession`'s or `loadSession`'s call arguments, so adding `_meta` to those calls won't break it — but it's still a second, overlapping file covering the same subject as `.spec.ts`, which is worth consolidating as its own follow-up (see Scope Boundaries).

---

## Open Questions

### Resolved During Planning

- Append vs. full-string replacement for `_meta.systemPrompt`: append, to preserve Claude Code's built-in default prompt (surfaced to and accepted by the user before planning began).
- Base+custom separator and ordering: base-then-custom, blank-line-joined, custom segment omitted when blank (see Key Technical Decisions).
- Column nullability: `NOT NULL DEFAULT ''`, not nullable.
- Max length: 20,000 characters, chosen to bound storage/log growth rather than to reflect any model-side constraint.
- Which duplicate session-manager test file to extend: `session-manager.service.spec.ts` — both it and its `.test.ts` sibling are actually live under this project's Jest config (both match the backend project's `testMatch`), so this is a choice between two overlapping active files, not a dead-code exclusion. `.spec.ts` is the larger, more recently-touched of the two and contains no conflicting assertions, so new coverage goes there; `.test.ts` needs no changes since it doesn't assert on the call arguments this plan changes.
- Whether the spawned agent already loads a project `CLAUDE.md` via `settingSources`: yes, unconditionally, controlled entirely by the vendored bridge — out of tdr-code's control and out of this plan's scope (see Scope Boundaries).
- Whether a more official/stable mechanism than `_meta.systemPrompt` exists for delivering a system prompt: checked `_meta.claudeCode.options` (rejected — raw pass-through, would require reimplementing append/preset merging, and is a collision hazard), the bridge's settings-file mechanism (confirmed no `systemPrompt` field on the SDK's `Settings` type), and environment variables (confirmed only `MAX_THINKING_TOKENS`/`CLAUDE_MODEL_CONFIG` exist, both unrelated). Also considered: writing the base prompt into a project `CLAUDE.md` instead of using `_meta.systemPrompt` — rejected because the agent has write access to the same shared workspace a `CLAUDE.md` would live in (per the Phase C plan's `--dangerously-skip-permissions` posture), so the agent could edit or delete its own constraint; the ACP-level mechanism has no such self-modification exposure. `_meta.systemPrompt` is the only session-scoped prompt-configuration surface the bridge exposes today.
- Whether a `rereadConfig()` landing mid-session-creation should be snapshotted per-attempt: no — accepted as last-value-wins, inheriting the same pre-existing timing behavior the four sibling config fields already have (see Key Technical Decisions).

### Deferred to Implementation

- Exact final wording of the base system prompt beyond the two required instructions — a concrete starting draft is included in Implementation Unit U2 below; refining tone/phrasing is an implementation-time judgment call, not an architectural one.
- Whether 20,000 characters is the right cap in practice — if operators find it limiting or excessive after real usage, adjusting a single zod constant is a trivial follow-up, not worth blocking this plan on.

---

## Implementation Units

- U1. **Config schema, migration, and seed default**

**Goal:** Add the `customSystemPrompt` column to the `config` table so the rest of the chain has somewhere to read from and write to.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `apps/tdr-code/src/db/schema.ts`
- Modify: `apps/tdr-code/src/db/config.repo.ts`
- Create: `apps/tdr-code/src/db/migrations/0008_*.sql` (generated via `drizzle-kit generate`, exact name/slug is tool-assigned)
- Test: `apps/tdr-code/src/db/__tests__/config.repo.spec.ts`

**Approach:**
- Add `customSystemPrompt: text('custom_system_prompt').notNull().default('')` to the `config` sqliteTable definition, no CHECK constraint (matches `cwd`/`claudeCommand`).
- `getOrSeedConfig`'s insert gets `customSystemPrompt: ''` (a literal, not an `env()` read — there is no corresponding `EnvKeys` entry for this field, unlike the other four).
- `ConfigPatch`, being `Partial<Omit<ConfigRow, 'id' | 'updatedAt'>>`, needs no code change to accept the new field.
- Generate the migration with `drizzle-kit generate` per the existing workflow; do not hand-write SQL.

**Patterns to follow:**
- The existing `cwd`/`claudeCommand` column declarations (NOT NULL, no CHECK) in `apps/tdr-code/src/db/schema.ts`.
- `getOrSeedConfig`'s existing per-field literal/env-default construction in `apps/tdr-code/src/db/config.repo.ts`.

**Test scenarios:**
- Happy path: `getOrSeedConfig` on a fresh DB seeds a row with `customSystemPrompt === ''`.
- Happy path: `updateConfig` persists a non-empty `customSystemPrompt` and it round-trips on a subsequent `getConfig` read.
- Edge case: `updateConfig` can set `customSystemPrompt` from a non-empty value back to `''` (clearing is a legitimate transition, not rejected).
- Edge case: a several-thousand-character value round-trips through SQLite/Drizzle without truncation or corruption (proves the column itself has no implicit length limit — the DB has no CHECK on this column by design; the 20,000-character cap is enforced entirely at the DTO layer, U3, not here).
- Integration: a `customSystemPrompt`-only patch still advances `updatedAt`, matching existing `updateConfig` behavior for other fields.

**Verification:**
- `config.repo.spec.ts` passes against a real in-memory SQLite instance (`createTestDb()`) with the new column present after migration.

---

- U2. **Base prompt constant, combination logic, and ACP wiring**

**Goal:** Define the hardcoded base prompt, combine it with the live custom prompt, and send the result on every session-creation and session-reactivation call.

**Requirements:** R2, R3, R4, R5, R6, R7

**Dependencies:** U1

**Files:**
- Create: `apps/tdr-code/src/agent/system-prompt.constants.ts`
- Modify: `apps/tdr-code/src/agent/session-manager.service.ts`
- Test: `apps/tdr-code/src/agent/__tests__/session-manager.config.spec.ts`
- Test: `apps/tdr-code/src/agent/__tests__/session-manager.service.spec.ts`

**Approach:**
- `system-prompt.constants.ts` exports one constant, e.g. `BASE_SYSTEM_PROMPT: string`, covering exactly R4 and R5 — no other content.
- `SessionManagerService` gains a sixth mutable private field, `customSystemPrompt: string`, set in the constructor and reassigned in `rereadConfig()` alongside the existing five (identical "new sessions only" semantics — no new apply-timing category).
- A small private method, e.g. `buildSystemPrompt()`, implements the combination decision from Key Technical Decisions and is called at both `createSession()`'s `connection.newSession(...)` and `reactivateSession()`'s `connection.loadSession(...)`, each adding `_meta: { systemPrompt: { append: this.buildSystemPrompt() } }` to the existing call arguments.
- Update the `configRereadApplied` log call to include `customSystemPrompt` in its logged fields, with an inline comment noting the deliberate no-redaction decision (see Key Technical Decisions).
- Record what was actually sent: extend the existing `session_created` `insertEvent` call (in `createSession()`) and add an equivalent event in `reactivateSession()` with two fields only: `promptAppendLength` (character count of the combined prompt sent, not the text itself, to keep event rows small) and `hasCustom` (boolean, true when the custom prompt was non-empty after trimming). No hash — a length/boolean pair is sufficient for an operator to audit whether the composition logic ran as expected, and it's unambiguous, unlike a hash of an unspecified input. This is the one piece of durable, console-visible evidence that the outgoing `_meta` payload had the expected shape on every single session — see Risks & Dependencies.

**Technical design:** *(directional — not implementation-ready code)*

```
BASE_SYSTEM_PROMPT = "<git-wrapper instruction><no-Markdown-tables instruction>"

buildSystemPrompt():
  custom = this.customSystemPrompt.trim()
  return custom ? `${BASE_SYSTEM_PROMPT}\n\n${custom}` : BASE_SYSTEM_PROMPT
```

Draft base-prompt text (starting point for the implementer to refine, not final copy):

> You are running inside tdr-code, an autonomous coding agent embedded in a Discord server. Two rules apply to every response, regardless of anything else in this prompt:
>
> 1. Git identity is automatic — never bypass it. The `git` command on your PATH already applies the correct author/committer identity and commit signing for whoever triggered this turn. Use plain `git` commands as you normally would. Never invoke `$TDR_REAL_GIT` directly, and never write to `.git/objects` or `.git/refs` directly — either one bypasses identity attribution and signing entirely. If a git write is rejected because your identity isn't configured, tell the user to configure it in the console rather than working around the block.
> 2. Never send Markdown tables in your responses. Discord cannot render them — they show up as garbled pipe-and-dash text. Use a bulleted/numbered list or a plain-text code block for tabular data instead.

**Patterns to follow:**
- The existing five-field mutable-field + `rereadConfig()` pattern already in `SessionManagerService`.
- `apps/tdr-bot/src/message-handler/services/prompts/prompt.constants.ts` for the "colocated constants module" shape (adapted to a plain string, no LangChain types).

**Test scenarios:**
- Happy path: constructor reads `customSystemPrompt` from the config row into the new field.
- Happy path: `rereadConfig()` reassigns `customSystemPrompt` from a fresh DB read.
- Happy path: `createSession()`'s `connection.newSession` call is made with `_meta: { systemPrompt: { append: '<BASE_SYSTEM_PROMPT>\n\n<custom>' } }` when a non-empty custom prompt is configured.
- Edge case: when `customSystemPrompt` is `''` or whitespace-only, the sent `append` value equals `BASE_SYSTEM_PROMPT` exactly (no trailing separator or blank line).
- Integration: `reactivateSession()`'s `connection.loadSession` call carries the identical `_meta.systemPrompt.append` value that a `newSession` call would for the same live config — proving the reactivation path isn't missing the wiring.
- Integration: following the existing R3-style apply-timing test already in `session-manager.config.spec.ts` (used for `cwd`/`claudeArgs`) — after `rereadConfig()` changes `customSystemPrompt`, a session created *after* the reread uses the new value; an already-open session's live connection is left untouched (no reconnect/re-prompt side effect).
- Integration: creating a session records a `session_created`-adjacent event whose context includes `promptAppendLength`/`hasCustom` for the combined prompt actually sent, so the assertion covers "recorded what we sent," not just "called newSession with the right argument."

**Verification:**
- Both `session-manager.config.spec.ts` and `session-manager.service.spec.ts` pass, with explicit assertions on the `_meta` argument shape at both call sites (not just that `newSession`/`loadSession` were called).
- A newly created session's event row shows the expected `promptAppendLength`/`hasCustom` values, giving an operator a permanent, queryable record per session — not just a one-time manual check at launch (see Risks & Dependencies, Documentation / Operational Notes).

---

- U3. **Config API layer: validation, service wiring, controller**

**Goal:** Let the console read and write `customSystemPrompt` through the existing validated REST chain.

**Requirements:** R1, R3, R7

**Dependencies:** U1

**Files:**
- Modify: `apps/tdr-code/src/console/config.dto.ts`
- Modify: `apps/tdr-code/src/console/config.service.ts`
- Test: `apps/tdr-code/src/console/__tests__/config.controller.spec.ts`

**Approach:**
- Add `customSystemPrompt: z.string().max(20_000, 'customSystemPrompt must be at most 20,000 characters').refine(v => !v.includes('\0'), 'customSystemPrompt must not contain NUL bytes')` to `UpdateConfigBodySchema`, and `customSystemPrompt: z.string()` to `ConfigResponseSchema`. Required (not `.optional()`) — the console always submits the full config object, matching the existing four-field pattern.
- `config.service.ts`'s `updateConfig()` adds `customSystemPrompt: body.customSystemPrompt` to its hand-listed `ConfigPatch` construction; `toDto()` adds the field to its hand-listed mapping. No change to the `reread_config` enqueue logic — it's already generic to "config changed," not per-field.
- Add an inline comment at the `configUpdated` log call site (`this.logger.info({ patch, event: LOG_EVENTS.configUpdated }, ...)`) noting that `customSystemPrompt` is intentionally logged in full (operator-authored config, not a secret).

**Patterns to follow:**
- `claudeArgs`'s existing `.max()` + NUL-byte `.refine()` in `config.dto.ts`.
- The existing hand-listed field construction in `config.service.ts`'s `updateConfig()` and `toDto()`.

**Test scenarios:**
- Happy path: `PUT /config` with a valid `customSystemPrompt` persists it and echoes it back in the response DTO.
- Happy path: an empty-string `customSystemPrompt` is accepted (the "no customization" state).
- Edge case: a `customSystemPrompt` over 20,000 characters is rejected with a `BadRequestException` carrying the zod message.
- Edge case: a `customSystemPrompt` containing an embedded NUL byte is rejected, mirroring the existing `claudeArgs` NUL-byte test.
- Integration: saving `customSystemPrompt` alongside the other four fields still enqueues exactly one `reread_config` command when a bot generation is running (proves the new field doesn't duplicate or break the existing enqueue-once behavior).

**Verification:**
- `config.controller.spec.ts` passes, with new cases following the file's existing `it.each`-style boundary-testing pattern for the other validated fields.

---

- U4. **Console UI textarea**

**Goal:** Give the operator a place to type and save the custom prompt.

**Requirements:** R1, R7

**Dependencies:** U3

**Files:**
- Modify: `apps/tdr-code/src/app/config/page.tsx`
- Create: `apps/tdr-code/src/app/config/__tests__/page.spec.tsx` (first test file for this page — no existing precedent; tooling — `@testing-library/react`, `jest-environment-jsdom`, `msw` — is already present at the app level)

**Approach:**
- Add a `customSystemPrompt` string state variable, seeded from the config query's `useEffect` alongside the other four fields.
- Render a new field block using the existing `FieldLabel` + `<textarea>` shape (modeled directly on the `claudeArgsJson` field, minus JSON parsing): `<FieldLabel label="Custom system prompt" effectLabel="new sessions only" />` with a larger `rows` (e.g. 6–8, since this is free-form prose rather than a one-line JSON array).
- Unlike `claudeArgsJson`, this field has no client-side syntax to validate — but it does have a server-side length cap (U3's 20,000-character max) with no client-side warning otherwise. Add a small character counter below the textarea (e.g. `{customSystemPrompt.length} / 20,000`, switching to a warning color near/at the cap), giving the operator the same before-submit feedback `claudeArgsJson`'s inline error gives for its own failure mode.
- Include `customSystemPrompt` in the `mutation.mutate({...})` payload on submit.

**Patterns to follow:**
- The `claudeArgsJson` field's local-state + textarea + `FieldLabel` shape in `apps/tdr-code/src/app/config/page.tsx` (styling via `cns()`).

**Test scenarios:**
- Happy path: the textarea is seeded with the value returned by the config query.
- Happy path: typing into the textarea and submitting includes the new value in the `PUT /config` payload alongside the unchanged existing fields.
- Happy path: the character counter reflects the current textarea length as the operator types.
- Edge case: submitting with the textarea cleared to empty sends `customSystemPrompt: ''` (not omitted).

**Verification:**
- The new `page.spec.tsx` passes; manual check in a dev browser confirms the field renders, saves, and reloads correctly (see project convention: verify UI changes in a real browser, not just via tests).

---

- U5. **Pin the ACP bridge's npx target version**

**Goal:** Stop shipping this feature's entire delivery mechanism (R4/R5) on top of an unpinned dependency that re-resolves fresh on every subprocess spawn. Added during review after two independent passes (security, scope) flagged the original plan — which called this "an immediate fast-follow" while still deferring it — as internally inconsistent: a safety-relevant instruction shouldn't ship on a foundation explicitly described as urgent-to-fix-later.

**Requirements:** Protects delivery of R4, R5

**Dependencies:** None — independent of U1–U4, can land in the same change

**Files:**
- Modify: `apps/tdr-code/src/db/config.repo.ts`
- Test: `apps/tdr-code/src/db/__tests__/config.repo.spec.ts`

**Approach:**
- Change `getOrSeedConfig`'s `claudeArgs` default from `['@agentclientprotocol/claude-agent-acp']` to a version-pinned equivalent (npx's `pkg@version` syntax), pinned to the exact version this plan verified `_meta.systemPrompt.append` against (`0.55.0`). This is a one-line literal change — it doesn't touch `claudeArgs`'s validation (already permits arbitrary strings) or an operator's ability to edit it afterward via the console, which is unchanged.
- This only changes the *seed default* a fresh install gets; it doesn't retroactively change an already-configured deployment's `claudeArgs` value (matching how every other config default already behaves — `getOrSeedConfig` only runs once, on first boot).

**Patterns to follow:**
- `getOrSeedConfig`'s existing literal-default construction in `apps/tdr-code/src/db/config.repo.ts` (`claudeCommand: env(EnvKeys.CLAUDE_COMMAND, 'npx')` and its sibling `claudeArgs` line) — no new pattern, just a different literal value.

**Test scenarios:**
- Happy path: `getOrSeedConfig` on a fresh DB seeds `claudeArgs` with the pinned version string, not the bare package name.
- Test expectation: none beyond the seed-default assertion above — a literal-value change has no other behavioral surface to exercise.

**Verification:**
- `config.repo.spec.ts`'s existing default-seed test asserts the pinned value.

---

## System-Wide Impact

- **Interaction graph:** Two ACP call sites in `session-manager.service.ts` (`newSession`, `loadSession`); the existing `command-poller.service.ts` → `rereadConfig()` propagation path (unchanged mechanism, one more field riding along); the existing console config REST chain. No other consumer reads `SessionManagerService`'s config fields or the `config` table.
- **Error propagation:** No new *crash-shaped* failure modes — string concatenation cannot throw, and validation failures surface through the existing zod → `BadRequestException` path already used by the other four fields. There is, however, a new *silent-non-delivery* failure mode that "no new failure modes" would otherwise undersell: R4 (the git-wrapper-bypass instruction) is a safety-relevant behavior delivered entirely through `_meta.systemPrompt`, which has no compile-time contract (the ACP SDK types `_meta` as `{ [key: string]: unknown } | null`) and no wire-level acknowledgment that it was understood. U5 removes the unpinned-dependency half of this risk; U2's event-logging proves tdr-code *sent* the right payload on every session, but neither proves the bridge *acted* on it — that gap stays open until the deferred canary session ships (see Risks & Dependencies).
- **State lifecycle risks:** None beyond what already exists for the sibling fields — the single-row `config` table update is one statement inside an existing `BEGIN IMMEDIATE` transaction; there is no partial-write state to worry about.
- **API surface parity:** None — this is fully internal to tdr-code; no other service or CLI reads this config.
- **Integration coverage:** The `newSession`-vs-`loadSession` parity test in U2 is the one cross-layer behavior that isolated unit mocks wouldn't otherwise prove — call it out explicitly in review rather than assuming symmetry.
- **Unchanged invariants:** The four existing config fields' validation, persistence, and "new sessions only"/"next reset"/"next create" apply-timing are untouched. The `reread_config` command-poller dispatch mechanism is unchanged (it re-reads the whole config row regardless of which fields changed).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The `_meta.systemPrompt` **key**, as the ACP transport vehicle, is an undocumented, bridge-specific convention on a dynamically-fetched (`npx`) dependency (`@agentclientprotocol/claude-agent-acp`) running in the same subprocess environment as git-write/SSH-signing credentials; a future upstream change could silently stop reading it, with no acknowledgment signal anywhere to detect this | U5 pins the npx target to the exact version this plan verified `_meta.systemPrompt.append` against, closing the "unpinned" half of this risk immediately rather than as a deferred follow-up. U2 additionally logs the append-length actually sent as a durable, console-visible event on every session (proves what tdr-code sent, forever, not just at launch — but not that the bridge acted on it). A scheduled canary session that asks a deterministic question and checks the answer is the one remaining fast-follow that can prove the latter (see Scope Boundaries). |
| The `{ append, excludeDynamicSections }` **shape** itself is comparatively lower risk — it's a documented, JSDoc'd field on `@anthropic-ai/claude-agent-sdk`'s public `Options.systemPrompt` type, not a bridge invention | No mitigation needed beyond normal dependency-upgrade vigilance; called out separately so it isn't conflated with the higher-risk transport-key concern above. |
| `_meta.claudeCode.options`, a second extension point in the same bridge handler, is spread into SDK options *after* the computed `systemPrompt` — anything that later sets `_meta.claudeCode.options.systemPrompt` would silently overwrite this feature's `append` value with no error | Nothing in this plan uses `claudeCode.options`; documented here so a future feature reaching for it knows the ordering hazard exists rather than rediscovering it via a mysteriously-reverted system prompt. |
| The combined prompt could be undermined by a project `CLAUDE.md` auto-loaded via `settingSources`, which tdr-code doesn't control | Documented as an accepted non-goal (see Scope Boundaries), consistent with this feature area's existing "UX nudge, not a containment boundary" posture toward the git wrapper itself. |
| An operator expects a saved prompt to apply to an already-open Discord conversation immediately | Mitigated the same way the four existing fields already are — an explicit `effectLabel="new sessions only"` label. For a bad **custom** prompt, an operator can also force-teardown an already-open channel session to pick up the fix immediately; a bad **base** prompt has no operator-facing kill-switch at all (code change + redeploy only) — a reason to keep the base prompt's initial wording conservative. |
| Markdown-table suppression is a soft instruction; the agent could still occasionally emit one | Explicitly out of scope to enforce server-side; documented as best-effort, matching the git wrapper's own framing. |
| Unbounded prompt text could bloat the config row or log lines over time | 20,000-character zod cap, mirroring the `claudeArgs` precedent for capping operator-editable, protocol-boundary-crossing text. |
| `PUT /config`'s only write guard is an `Origin`-header match (`config.controller.ts`'s own code comment already flags this route for the tracked Phase D/D6 deny-by-default auth work) — this pre-existing gap is not introduced by this plan, but this plan raises its stakes: today, bypassing it lets an attacker tamper with spawn parameters; after this ships, the same bypass reaches directly into the agent's own instruction stream. | Not fixed here — pre-existing and out of scope — but named explicitly so D6's prioritization accounts for the larger blast radius this field adds, rather than treating `customSystemPrompt` as parity with the other five settings. |

---

## Documentation / Operational Notes

- **At launch:** manually verify the base prompt is reaching a live session (ask a running channel session what it should never send, or what it should do before a git push). This is a one-time sanity check, not the ongoing safeguard — see below for why a one-off check isn't sufficient on its own.
- **Built by this plan:** U5 pins the bridge to the exact version this plan verified against, so R4/R5's delivery mechanism can't silently change between now and whenever a future dependency bump is deliberately reviewed. U2 additionally logs the append-length of the combined prompt actually sent as a durable event on every session, visible on the existing events console page — this proves what tdr-code *sent* on every session going forward, not just the one tested at launch.
- **Still unverified, ongoing (fast-follow, not built by this plan):** even with U5's pin, nothing in this plan proves the pinned bridge version *acts* on `_meta.systemPrompt` beyond the one-time launch check above. A scheduled canary session (see Scope Boundaries → Deferred to Follow-Up Work) is the only check that can close that gap — the event log shows tdr-code's outgoing payload was correct even if the bridge silently ignored it.
- **Rollback, split by which layer is misbehaving:** a bad **custom** prompt is fixed by clearing the textarea and saving, then force-tearing-down any already-open channel sessions that need the fix immediately (idle sessions pick it up naturally on next reactivation). A bad **base** prompt has no operator-facing kill-switch — it requires a code change and redeploy — which is a reason to keep its initial wording conservative.
- No `docs/solutions/` update is expected from this plan alone; if the `_meta.systemPrompt` mechanism turns out to need a workaround or breaks on a future `claude-agent-acp` version bump, that's a strong future `/ce-compound` candidate.

---

## Sources & References

- Related code: `apps/tdr-code/src/agent/session-manager.service.ts`, `apps/tdr-code/src/db/schema.ts`, `apps/tdr-code/src/console/config.*`, `apps/tdr-code/src/app/config/page.tsx`, `apps/tdr-code/scripts/git`, `apps/tdr-code/src/db/events.repo.ts`, `apps/tdr-code/src/bot.module.ts` (confirms `@nestjs/schedule`'s `ScheduleModule` is already registered, relevant to the deferred canary-session follow-up)
- Prior plan (established the config chain this plan extends): `docs/plans/2026-07-01-001-feat-tdr-code-phase-c-config-git-identity-plan.md`
- External dependency (behavior confirmed by reading the vendored, dynamically-fetched source — not committed to this repo): `@agentclientprotocol/claude-agent-acp@0.55.0`, specifically its `getOrCreateSession()` handler
- External dependency, documented: `@anthropic-ai/claude-agent-sdk`'s public `Options.systemPrompt` type (JSDoc'd, includes a "Default with additions" example matching this plan's `{ type: 'preset', preset: 'claude_code', append: '...' }` usage) — the source of confidence for the `append` shape itself, as distinct from the bridge-specific `_meta.systemPrompt` transport key
