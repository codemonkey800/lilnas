---
name: lilnas-code-review
description: |
  Run a standalone code review on lilnas changes — correctness, testing,
  maintainability, project standards — plus conditional reviewers (kieran-
  typescript, julik-frontend-races, security, performance, api-contract,
  reliability, equations-security, adversarial, code-simplicity, previous-
  comments). Writes a numbered, severity-sorted, emoji-rich report with
  code snippets, fix options, trade-offs, a selectable summary list, and a
  recommendation to `REVIEW.md` at the repo root (any prior `REVIEW.md` is
  deleted first); the chat shows only the picker and recommendation so you
  can reply with issue numbers inline. Use before pushing a lilnas PR or
  any time the user types /lilnas-code-review. Fully self-contained — no
  dependency on /ce-code-review or the compound-engineering plugin.
user-invocable: true
argument-hint: "<prompt> — e.g. 45897, my-branch, 'last 3 commits', 'unstaged changes', base:<ref>, <sha1>..<sha2>"
---

# Lilnas Code Review

A pre-push code review skill for lilnas work. Spawns 4 always-on reviewer personas (correctness, testing, maintainability, project-standards) plus conditional reviewers (kieran-typescript, julik-frontend-races, security, performance, api-contract, reliability, equations-security, adversarial, code-simplicity, previous-comments) in parallel, merges findings, and produces an emoji-rich numbered report.

The full markdown report is written to `REVIEW.md` at the repo root (any prior `REVIEW.md` is deleted first so reports don't stack); the chat shows only the summary picker and recommendation so you can reply with issue numbers inline.

Read-only by design. No fixes are applied. The user picks issue numbers from the final summary and addresses them manually.

## When to use

- Pre-push on a lilnas branch.
- After addressing earlier reviewer feedback, to verify nothing was missed.
- On any `apps/**` or `packages/**` diff — NestJS services, Discord bots, Next.js/Vite frontends, shared libraries, Docker compose deploy files, or the LaTeX sandbox in `apps/equations/`.
- When the user types `/lilnas-code-review` with or without arguments.

## Prompt interpretation

`<prompt>` is free-form natural language. Parse it into a concrete diff scope before dispatching reviewers. Strip recognized tokens and interpret the remainder.

| User says…                              | Resolved scope                                                  | How                                              |
|-----------------------------------------|-----------------------------------------------------------------|--------------------------------------------------|
| (blank)                                 | Current branch vs detected base                                 | `bash references/resolve-base.sh`                |
| `45897` (a number) or full PR URL       | PR's diff after `gh pr checkout`                                | Stage 1 PR path                                  |
| `my-branch` (a local branch)            | Branch vs detected base                                         | Stage 1 branch path                              |
| `base:HEAD~3`                           | Last 3 commits + working tree                                   | direct `base:` use                               |
| `last 3 commits` / `last N commits`     | `base:HEAD~N`                                                   | NLP → `base:HEAD~N`                              |
| `unstaged changes` / `working tree`     | `base:HEAD` (`git diff $BASE` covers uncommitted edits)         | NLP → `base:HEAD`                                |
| `staged changes`                        | `base:HEAD`, with a header note that scope covers staged + unstaged together (`git diff $BASE` does not isolate `--cached`) | NLP → `base:HEAD` |
| `commit a1b2c3d`                        | `base:a1b2c3d^` (parent of that commit)                         | NLP → `base:<sha>^`                              |
| `between abc and def` / `abc..def`      | Explicit range `abc..def` — both ends pinned                    | direct range use                                 |
| `the changes I made to <path>`          | `base:HEAD~N` where N covers all branch commits touching that path; mention the path filter in the header | `git log --oneline -- <path>` to count commits  |
| anything containing `plan:<path>`       | Use `<path>` as the plan for requirements verification          | NLP → `plan:<path>`                              |

**Rules:**

- **`base:` cannot combine with a PR number or branch target.** If both appear, stop with: `❌ Cannot use base: with a PR number or branch target — base: implies the current checkout is already the correct branch. Pass base: alone, or pass the target alone and let scope detection resolve the base.`
- **An explicit range (`<ref1>..<ref2>`) cannot combine with a PR number or branch target**, for the same reason. If both appear, stop with: `❌ Cannot use an explicit commit range with a PR number or branch target — a range implies the current checkout already has both commits reachable. Pass the range alone, or pass the target alone and let scope detection resolve the base.`
- **No modes accepted.** This skill is interactive-only and read-only. If `<prompt>` contains `mode:autofix`, `mode:headless`, or `mode:report-only`, reject with: `❌ /lilnas-code-review is interactive and read-only — no mode flags accepted.`
- **Ambiguous prompt.** When the natural-language parse leaves real doubt about scope, ask the user one clarifying question (use `AskUserQuestion` in Claude Code, `request_user_input` in Codex, the platform equivalent elsewhere). Do not dispatch reviewers until scope is resolved.

## Stage 1: Resolve diff scope

Pick the path that matches the parsed prompt.

### If `base:<ref>` was given

Use the ref directly. Verify the worktree state is sane and capture the diff:

```
git rev-parse --verify <ref>
BASE=$(git rev-parse <ref>)
echo "BASE:$BASE"
echo "FILES:"
git diff --name-only $BASE
echo "DIFF:"
git diff -U10 $BASE
echo "UNTRACKED:"
git ls-files --others --exclude-standard
```

### If an explicit range `<ref1>..<ref2>` was given

Both ends are pinned — this is for reviewing a fixed set of commits regardless of what lands on the branch afterward (e.g. a wrapper skill handing off the exact commit range it just produced). Never substitute `<ref2>` with `HEAD`, even when it happens to equal HEAD right now — the whole point is to ignore whatever HEAD becomes later.

```
git rev-parse --verify <ref1>
git rev-parse --verify <ref2>
BASE=$(git rev-parse <ref1>)
RANGE_HEAD=$(git rev-parse <ref2>)
git merge-base $BASE $RANGE_HEAD
```

- If the `merge-base` output doesn't equal `$BASE`, `<ref1>` isn't an ancestor of `<ref2>`. Stop with: `❌ <ref1> is not an ancestor of <ref2> — check the range order (base first, head second).`
- Otherwise, capture the diff:
  ```
  echo "BASE:$BASE"
  echo "RANGE_HEAD:$RANGE_HEAD"
  echo "FILES:"
  git diff --name-only $BASE $RANGE_HEAD
  echo "DIFF:"
  git diff -U10 $BASE $RANGE_HEAD
  ```

No `UNTRACKED:` marker in this mode — a diff between two fixed commits has no relationship to the current working tree, so there's nothing to check.

### If a PR number or GitHub URL was given

```
gh pr view <number-or-url> --json state,title,body,baseRefName,headRefName,url,files
```

- If `state` is `CLOSED` or `MERGED`, stop with `PR is closed/merged; not reviewing.`
- Otherwise: verify the worktree is clean before switching branches:
  ```
  git status --porcelain
  ```
  If non-empty: `You have uncommitted changes. Stash or commit them before reviewing a PR, or run /lilnas-code-review with no argument to review the current branch as-is.`
- Then check out the PR:
  ```
  gh pr checkout <number-or-url>
  ```
- Compute the local diff against the PR's base branch (fork-safe — read the base repo from the PR URL, fetch the base branch from that repo, compute merge-base against it).
- Capture the same `BASE:` / `FILES:` / `DIFF:` / `UNTRACKED:` markers above.

### If a branch name was given

Verify worktree clean, `git checkout <branch>`, then run `bash references/resolve-base.sh` to determine the base. Capture markers.

### If standalone (no argument or natural-language scope)

Run `bash references/resolve-base.sh` to detect the base. Capture markers.

### Scope guard: lockfile / generated-only diffs

After capturing `FILES:`, check whether 100% of changed files match generated/lockfile patterns:

- `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- `**/dist/**`, `**/build/**`, `**/.next/**`, `**/generated/**`
- `**/__snapshots__/**`
- `**/.turbo/**`

If all files match, print:
```
📦 Diff is lockfile/snapshot/generated-only — skipping review.
```
…and stop. There's nothing useful for reviewers to look at.

### Untracked file handling

Always inspect `UNTRACKED:` when Stage 1 captured one. If non-empty, tell the user which files are excluded. If any of them should be reviewed, stop and recommend `git add` + rerun. Explicit-range mode never captures `UNTRACKED:` (see above) — skip this check entirely in that mode.

## Stage 2: Intent discovery

Understand what the change is trying to accomplish.

- **PR mode:** use PR title + body + linked issues from `gh pr view`. Supplement with commit messages if the body is sparse.
- **Branch / standalone mode:** run `git log --oneline ${BASE}..${RANGE_HEAD:-HEAD}` to get commit subjects and bodies — `RANGE_HEAD` is only set when Stage 1 resolved an explicit range; every other path still walks to `HEAD`.

Compose a 2–3 line intent summary:

```
Intent: Add the `tikz` package to the LaTeX whitelist in apps/equations so
TikZ diagrams render via the existing pdflatex sandbox. Must not regress
the secure-exec subprocess isolation or the rate-limit tiers.
```

Pass this to every reviewer in the spawn prompt.

**When intent is ambiguous and you can ask:** ask one question via the platform's blocking question tool. "What is the primary goal of these changes?"

## Stage 3: Reviewer selection

Four reviewers are always-on. Read the diff and the file list, then decide which conditional reviewers to add. Selection is agent judgment, not pure keyword matching.

### Always-on (4)

| Persona               | Persona file                                                            |
|-----------------------|-------------------------------------------------------------------------|
| `correctness`         | `reviewers/always-on/correctness.md`                                    |
| `testing`             | `reviewers/always-on/testing.md`                                        |
| `maintainability`     | `reviewers/always-on/maintainability.md`                                |
| `project-standards`   | `reviewers/always-on/project-standards.md`                              |

### Conditional triggers (10)

| Persona                  | Trigger heuristic |
|--------------------------|-------------------|
| `kieran-typescript`      | Any changed file matches `*.ts` / `*.tsx` (excluding `*.test.ts*`, `*.spec.ts*`, `*.d.ts`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/__generated__/**`) |
| `julik-frontend-races`   | Diff touches `.tsx` or `.jsx` under any frontend (`apps/portal/`, `apps/dashcam/`, `apps/macros/`, `apps/swole/`, or admin/web folders inside hybrid apps like `apps/tdr-bot/`, `apps/download/`, `apps/yoink/`) AND contains any of `useEffect`, `useState` with timer/animation setters, `useMutation`, `useSubscription`, `setTimeout`, `setInterval`, `requestAnimationFrame`, or hand-written DOM event wiring |
| `security`               | Diff touches NestJS handlers (`apps/*/src/**/*.controller.ts`, `**/*.guard.ts`, `**/*.middleware.ts`, `**/*.strategy.ts`), `apps/yoink/src/auth/**`, Zod validation schemas, subprocess invocation (`spawn`, `exec`, `execFile`, `child_process`), file-system writes outside `os.tmpdir()`, secrets handling, or introduces user-controlled input on a public route |
| `performance`            | Diff adds new `.map` / `.filter` / `.reduce` chains in controllers or services over request data, removes a `useMemo` / `useCallback` / `React.memo`, adds new render-heavy code paths in any frontend, adds new Drizzle queries (especially inside loops), introduces unbounded LangChain agent loops (`apps/tdr-bot/src/messages/llm/**`), or adds per-request work in NestJS pipelines |
| `api-contract`           | Diff touches shared package exports (`packages/{utils,media,lidarr-client,token-client}/src/index.ts` or other `**/src/index.ts`), NestJS controller route signatures / DTO shapes, Zod schemas exposed externally (request bodies, equations LaTeX input, yoink download types), or Discord command signatures (Necord `@SlashCommand` arguments) |
| `reliability`            | Diff touches NestJS async handlers, scheduled jobs (`@nestjs/schedule` `@Cron`), Discord client event handlers (`ClientEvents.*`, Necord `@On`/`@Once`), Drizzle migrations or queries, Radarr/Sonarr/Lidarr HTTP client retry logic, LangChain workflow nodes, Docker compose `deploy.yml` / `deploy.dev.yml` health-checks/restart-policy/depends_on, or cleanup of timers / event listeners / subprocess handles |
| `adversarial`            | ≥50 changed non-test/non-generated lines, OR diff touches the LaTeX sandbox (`apps/equations/`), OAuth + JWT (`apps/yoink/src/auth/`), Discord guards/middleware, subprocess spawn anywhere, Docker entrypoints, LangChain tool-calling (`apps/tdr-bot/`), shared library exports, Drizzle migrations, file-system writes in `apps/download/` or `apps/equations/`, or external API integrations |
| `equations-security`     | Any file under `apps/equations/src/**`, `apps/equations/Dockerfile`, or `apps/equations/image-magick-policy.xml` changes. The equations service has its own SECURITY.md and an explicit defense-in-depth model (Zod validation → secure-exec → restricted TeX → ImageMagick policy → rate limits); any diff here gets a dedicated reviewer |
| `code-simplicity`        | New abstraction introduced (new class / factory / interface), ≥3 new files added in a single feature, single-use component file, OR `<prompt>` contains `simplicity` / `simplify` keywords |
| `previous-comments`      | PR mode (Stage 1 PR path) AND `gh pr view --json comments,reviews` returns non-empty review activity |

### Announce the team

Before spawning, print the roster with one-line trigger justifications for the conditionals:

```
Review team:
✅ correctness (always)
✅ testing (always)
✅ maintainability (always)
✅ project-standards (always)
🔡 kieran-typescript — 6 .ts/.tsx files changed
🧪 equations-security — edits apps/equations/src/validation/equation.schema.ts
🛡️ security — touches NestJS guard in apps/yoink/src/auth
🤖 adversarial — 84 changed lines, touches subprocess spawn in equations
```

This is progress reporting, not a blocking confirmation.

## Stage 3b: Discover project-standards paths

Before spawning, find the file paths (not contents) of all relevant standards files for the `project-standards` persona. Use the platform's glob/file-search tool:

1. Find all `**/CLAUDE.md`, `**/AGENTS.md`, and `**/.agents/common/**.mdc` in the repo.
2. Filter to those whose directory is an ancestor of at least one changed file. A standards file governs all files below it.

Pass the list to the `project-standards` persona inside a `<standards-paths>` block in its review context. The persona reads the files itself.

In lilnas, the canonical root standards file is `/Users/jeremyasuncionnetflix.com/dev/lilnas/CLAUDE.md` (covers pnpm/Turbo conventions, ESLint flat config, Prettier rules, NestJS/Next.js/Vite/Discord conventions, Docker base images, security guidance for the equations service, and storage/deployment patterns). Individual apps may add their own `CLAUDE.md` later — discover dynamically.

If no standards files exist anywhere in the repo, still spawn the `project-standards` persona — its job in that case is to verify the lack of standards is not itself a regression (e.g. someone deleted CLAUDE.md without replacement). Pass an empty `<standards-paths>` block.

## Stage 4: Spawn reviewers

Spawn each selected reviewer as a parallel sub-agent (using `Agent` with `subagent_type: general-purpose` in Claude Code, the equivalent sub-agent invocation in Codex, or the platform's parallel-task mechanism elsewhere). All reviewers inherit the session model.

Each spawn prompt is built from `references/subagent-prompt-template.md` with these substitutions:

- `{persona_file}` — contents of `reviewers/always-on/<name>.md` or `reviewers/conditional/<name>.md`
- `{diff_scope_rules}` — contents of `references/diff-scope.md`
- `{schema}` — contents of `references/findings-schema.json`
- `{intent_summary}` — output of Stage 2
- `{pr_metadata}` — PR title/body/URL when reviewing a PR; empty otherwise
- `{file_list}` — `FILES:` block from Stage 1
- `{diff}` — `DIFF:` block from Stage 1 (`git diff -U10 $BASE`, or `git diff -U10 $BASE $RANGE_HEAD` in explicit-range mode)
- `{reviewer_name}` — persona name (e.g. `"correctness"`, `"kieran-typescript"`, `"equations-security"`)
- `{trigger_reason}` — for conditional reviewers, the heuristic that fired (e.g. `"6 .tsx files changed"`). Empty for always-on.
- For `project-standards` only: append a `<standards-paths>` block with the path list from Stage 3b.

Dispatch all reviewers in parallel — one sub-agent invocation per persona, all in a single message where the platform allows it. Reviewers return compact JSON only (no file writes, no run-id artifacts).

## Stage 5: Merge findings

Convert reviewer compact JSON returns into one deduplicated, confidence-gated finding set.

1. **Validate.** For each return, check required top-level fields (`reviewer`, `findings`, `residual_risks`, `testing_gaps`) and per-finding fields (`title`, `severity`, `file`, `line`, `why_it_matters`, `confidence`, `evidence`, `pre_existing`). Drop malformed returns or findings. Record the drop count.
   - `severity` ∈ `{P0, P1, P2, P3}`
   - `confidence` ∈ `{0, 25, 50, 75, 100}`
   - `evidence` is an array with ≥1 string
   - `pre_existing`, `requires_verification` (if present) are booleans

2. **Deduplicate.** Compute fingerprint: `normalize(file) + line_bucket(line, ±3) + normalize(title)`. When fingerprints match, merge: keep the highest severity, keep the highest confidence, append the contributing reviewer's name to a `lenses[]` list.

3. **Cross-reviewer agreement promotion.** When 2+ independent reviewers flag the same fingerprint, promote confidence one anchor step: `50 → 75`, `75 → 100`, `100 → 100`. Note the agreement in the merged finding's `lenses[]`.

4. **Separate pre-existing.** Pull out findings with `pre_existing: true` into a separate list. These do not count toward the verdict.

5. **Confidence gate.** Suppress remaining findings below anchor 75. **Exception:** P0 findings at anchor 50+ survive. Record the suppressed count by anchor so it can appear in Coverage if needed.

6. **Sort.** Order surviving findings by:
   1. severity (P0 → P1 → P2 → P3)
   2. confidence (100 → 75 → 50)
   3. file path
   4. line number

7. **Assign global numbers.** Number the sorted list contiguously starting from `1`. These numbers drive both the per-finding section headers and the bottom summary picker.

8. **Collect coverage data.** Union all reviewers' `residual_risks` and `testing_gaps`.

## Stage 6: Render output

The full markdown report is **written to `REVIEW.md` at the repo root** using the templates below. The chat receives only a confirmation line + the summary picker + the recommendation block so the user can reply with issue numbers inline.

### Step 1 — Reset the report file

1. Resolve the repo root: `REPO_ROOT=$(git rev-parse --show-toplevel)`. The report path is `${REPO_ROOT}/REVIEW.md`. The skill may be invoked from a subdirectory like `apps/equations/`, so always anchor on the repo root — never the current working directory.
2. Delete any prior report via Bash: `rm -f "${REPO_ROOT}/REVIEW.md"`. The `-f` flag makes this a no-op when the file doesn't exist, so there's no need to check first and no error to handle.

Do the delete immediately before the write (Step 3), not at skill startup, so a mid-run failure leaves the previous report intact rather than wiping it out. If Stage 1 hit the lockfile/generated-only skip path, or the prompt was rejected before Stage 6, do **not** touch `REVIEW.md` — leave any prior report in place.

### Step 2 — Assemble the report content

Use the templates below verbatim. Emoji are part of the contract. Concatenate the sections in this order: Header → Severity sections (P0 → P1 → P2 → P3) → Pre-existing (if any) → Summary picker → My recommendation → Coverage (if any).

### Header

```
# 🔍 Lilnas Code Review

📊 **Scope:** <human-readable scope description>  (<N files>, ±<add>/<del> lines)

🎯 **Intent:** <intent summary from Stage 2, one or two lines>

👀 **Reviewers (always-on):** ✅ correctness · ✅ testing · ✅ maintainability · ✅ project-standards

🎚️ **Conditional:** <emoji label> · <emoji label> · ...    ← only the conditionals that actually fired

🧮 **Findings:** <total>  •  🚨 <p0_count> P0  •  ⚠️ <p1_count> P1  •  📝 <p2_count> P2  •  💭 <p3_count> P3
```

**Critical rendering rule:** Every line in the header above must be separated from the next by a blank line, otherwise the markdown renderer joins them into one wrapped paragraph and the report becomes unreadable. The `# 🔍 Lilnas Code Review` heading also separates the report visually from any preceding progress text.

If no conditional reviewers fired, omit the `🎚️ Conditional:` line entirely. If the total is zero, render the header, skip the severity sections, and jump to a "✨ All clear" block (see "Clean review" below).

### Severity sections

For each non-empty severity in order P0 → P1 → P2 → P3, render a level-2 markdown heading, then every finding at that severity:

```
## 🚨 P0 — Critical (must fix before merge)
```

Banner labels (always render as exact `##` headings, never as decorated text — box-drawing characters like `═══` get interpreted by the markdown renderer as horizontal rules and the emoji+text floats to the line-end, which breaks the report):

- `## 🚨 P0 — Critical (must fix before merge)`
- `## ⚠️ P1 — High (should fix)`
- `## 📝 P2 — Moderate (fix if straightforward)`
- `## 💭 P3 — Low (user's discretion)`

### Per-finding block

```
### <N>. ❌ <title> — `<file>:<line>`

**🤔 Description**

<why_it_matters from the merged finding — 2–4 sentences>

**🔍 Problem code**

\`\`\`<lang inferred from file extension>
<problem_code snippet — from the merged finding, or extracted from the diff hunk ±10 lines, or read from the file ±5 lines as last resort>
\`\`\`

**💡 Potential solutions**

- Option A — <approach>: <one-line pro/con>
- Option B — <approach>: <one-line pro/con>
- 🎯 **Recommendation:** <which option and why, in one sentence>

OR (when there is only one obvious fix):

**💡 Why this fix:** <one-line justification of the suggested fix>

OR (when no clean fix exists and trade-offs depend on context):

**⚖️ Trade-off:** <describe the tension>. Discuss with author.

**✅ Recommended solution**

\`\`\`<lang>
<suggested_fix snippet>
\`\`\`

**🏷️ Lens:** <lens-1> · <lens-2 if cross-corroborated> · **🎯 Confidence:** <50 | 75 | 100>

---
```

**Critical rendering rule:** Every bold sub-label (`**🤔 Description**`, `**🔍 Problem code**`, `**💡 Potential solutions**`, `**✅ Recommended solution**`) must be followed by a blank line before its content. Without the blank line, the bold label and the next line collapse into one wrapped paragraph and the label looks like inline prose. Inline labels that end with a colon (`**💡 Why this fix:** …`, `**⚖️ Trade-off:** …`, `**🏷️ Lens:** …`) are exempt — they're meant to flow inline.

Notes on populating each block:

- **`<lang>`**: infer from file extension. `.tsx` → `tsx`, `.ts` → `ts`, `.jsx` → `jsx`, `.js` → `js`, `.css` → `css`, `.json` → `json`, `.md` → `md`, `.sh` → `bash`, `.yml`/`.yaml` → `yaml`, `.dockerfile`/`Dockerfile` → `dockerfile`, others → no language.
- **`problem_code`** population order: (a) merged finding's `problem_code` field if present, (b) extract ±10 lines from the in-memory diff hunk where this `file:line` lives, (c) read the file at `line ± 5` as last resort.
- **`recommended solution`** population: use the merged finding's `suggested_fix` if present. If the finding has a `fix_options[]` array with 2+ entries, render the **💡 Potential solutions** block with those entries.
- **Recommendation logic** when rendering options:
  - If one option is clearly better (e.g. matches an existing repo pattern, lower risk), state the recommendation explicitly.
  - If trade-offs depend on context the reviewer can't resolve, state "⚖️ Trade-off depends on <X>: discuss with author."
- **Lens badge** lists all contributing reviewers from `lenses[]` separated by `·`. If two reviewers corroborated, that's a stronger signal — display both.

### Pre-existing findings

After the P3 section, if pre-existing findings exist, add a separate section that does not count toward the verdict:

```
## 🗂️ Pre-existing (not introduced by this diff)

N. 📝 [P2] <title> — `<file>:<line>` · 🏷️ <lens>
...
```

One-line each, no problem-code / recommended-solution blocks. These are FYI only.

### Summary picker

Always render the summary, even when there's only one finding:

```
## 📋 Summary — pick what to address

1. 🚨 [P0] <one-line summary> — `<file>:<line>`
2. ⚠️ [P1] <one-line summary> — `<file>:<line>`
3. ⚠️ [P1] <one-line summary> — `<file>:<line>`
4. 📝 [P2] <one-line summary> — `<file>:<line>`
5. 💭 [P3] <one-line summary> — `<file>:<line>`
```

The numbers must match the per-finding section numbers above. Render each item flush-left with no leading space — a leading space turns the ordered list into an indented paragraph in stricter renderers.

### My recommendation

Apply the rubric in the next section to bucket findings, then render:

```
## 🎯 My recommendation

🚀 **Fix before merge:** #<n>, #<n>, ...    ← omit paragraph entirely if empty

👍 **Worth grabbing while you're here:** #<n>, #<n>, ...    ← omit if empty

💤 **Skip unless polishing:** #<n>, #<n>, ...    ← omit if empty

⚖️ **Discuss:** #<n> (<one-line context>) ...    ← omit if empty

📨 Reply with the issue numbers you want to address (e.g. `1, 2, 4` or `all P0/P1`).
```

**Critical rendering rule:** Each bucket line must be separated from the next by a blank line, otherwise they collapse into one wrapped paragraph.

If no bucket has any items, render a "✨ All clear" block instead:

```
## ✨ All clear — no actionable findings

Nothing surfaced above the confidence gate.

<If pre-existing findings exist: "K pre-existing findings noted above for awareness.">

<If residual_risks or testing_gaps are non-empty: "See Coverage below.">
```

### Coverage (optional)

If `residual_risks` or `testing_gaps` are non-empty, render at the very bottom:

```
## 📊 Coverage

Residual risks the reviewers flagged but didn't promote to findings:

- <risk>
- <risk>

Testing gaps the reviewers flagged:

- <gap>
- <gap>

Suppressed: <N> findings below anchor 75 (P0 at anchor 50+ retained).
```

### Step 3 — Write REVIEW.md

After assembling the sections from Step 2, write the full concatenated markdown to `${REPO_ROOT}/REVIEW.md` via the platform's file-write tool (`Write` in Claude Code, equivalent elsewhere). The file is the canonical artifact of the review — the user opens it in an editor to read findings, scroll, and search. This is the only place the full report lives.

### Step 4 — Print to the chat

Once `REVIEW.md` is on disk, print to the chat — and only print — three blocks in this exact order:

1. **One-line confirmation**, with the absolute path filled in from `${REPO_ROOT}/REVIEW.md`:

   ```
   📝 Wrote review to `REVIEW.md` (<absolute-path-to-REVIEW.md>) — <total> findings: 🚨 <p0_count> P0 · ⚠️ <p1_count> P1 · 📝 <p2_count> P2 · 💭 <p3_count> P3.
   ```

2. The **`## 📋 Summary — pick what to address`** block from Step 2, rendered verbatim with finding numbers that match the per-finding section headers in `REVIEW.md`.

3. The **`## 🎯 My recommendation`** block from Step 2, rendered verbatim — including the `📨 Reply with the issue numbers…` prompt at the bottom.

Do **not** print the header, severity sections, per-finding blocks, pre-existing block, or Coverage to the chat — those live only in `REVIEW.md`. The summary picker and recommendation are the only sections that appear in both places, and their numbering must stay consistent across them.

### Clean review

If Stage 5 produced zero post-gate findings (the "✨ All clear" path):

1. Write `REVIEW.md` containing **only** the Header block + the `## ✨ All clear — no actionable findings` block + the Coverage section if `residual_risks` or `testing_gaps` are non-empty. Skip the severity sections, per-finding blocks, summary picker, and recommendation in the file.
2. Print to the chat only the one-line confirmation from Step 4 followed by the `## ✨ All clear — no actionable findings` block — no picker, no recommendation, since there's nothing to pick.

## Recommendation rubric

Bucket each finding into exactly one of:

- **🚀 Fix before merge** — every P0 (regardless of confidence); every P1 with confidence ≥ 75; any P1 in the same file as a P0; security findings at any P-level with confidence ≥ 50; any `equations-security` finding at confidence ≥ 50 (the LaTeX sandbox has no margin for regression).
- **👍 Worth grabbing while you're here** — P2 findings co-located in the same file as a 🚀 finding; P2 findings whose lens matches a 🚀 finding's lens (likely related); any P2 with confidence = 100.
- **💤 Skip unless polishing** — P3s; P2 findings at confidence 50; any nit-style finding.
- **⚖️ Discuss** — findings whose only fix path is a `⚖️ Trade-off` block (no clear recommendation).

A finding lands in exactly one bucket. When two rules could apply, pick the more aggressive bucket (Fix before merge > Worth grabbing > Skip).

## Stage 7: Reply path

Finding numbers refer to the per-finding section headers inside `REVIEW.md` and the summary picker printed to the chat at the end of Stage 6. Both must stay in sync — that's what makes this stage work.

When the user replies with issue numbers (e.g. `1, 3, 5`, `all P0`, `all P0/P1`), the skill's job is to record the picks for follow-up, not to apply fixes.

1. Parse the reply into a concrete list of finding numbers. Validate each is in range.
2. For each picked finding, create one todo item via the platform's task tool (`TaskCreate` in Claude Code, the equivalent task primitive elsewhere). Each todo:
   - **subject**: the finding's title
   - **description**: a 2-3 line summary including file:line, severity, recommended solution snippet (if any), and the lens(es)
   - **activeForm**: "Addressing <finding title>"
3. After creating todos, print a single line confirming: `📨 Created N todos for issues <list>. Drive each one through your normal flow.`

Do not apply fixes from this skill. The picker is meant to slot the chosen findings into the user's normal work loop, not auto-resolve them.

## Quality gates

Before delivering the report:

1. **Every finding is actionable.** Re-read each finding. If it says "consider", "might want to", or "could be improved" without a concrete fix, rewrite it with a specific action or drop it.
2. **No false positives from skimming.** For each finding, verify the surrounding code was actually read. Check that the "bug" isn't handled elsewhere in the same function, that the "unused import" isn't used in a type annotation, that the "missing null check" isn't guarded by the caller.
3. **Severity is calibrated.** A style nit is never P0. A LaTeX subprocess-argument injection is never P3. Re-check every severity assignment.
4. **Line numbers are accurate.** Verify each cited line number against the file content.
5. **Findings don't duplicate linter output.** Don't flag things ESLint, Prettier, or tsc would catch (missing semicolons, wrong indentation, type errors). Focus on semantic issues. (Per lilnas's CLAUDE.md, code must already pass prettier and lint — those checks are upstream.)
6. **Recommendation matches findings, and chat picker matches `REVIEW.md`.** If you tag a finding as 🚀, the summary must also list it under 🚀. The summary picker numbering in `REVIEW.md` must match the per-finding section numbering in the same file, and the picker block printed to the chat must use the same numbers as `REVIEW.md` — Stage 7 relies on this consistency to map reply numbers to findings.
7. **Emoji are part of the contract.** Use the exact emoji shown in the templates above. Do not paraphrase or substitute.
8. **Markdown structure is part of the contract.** Section banners are `## H2` headings — never decorate them with `═══`, `───`, `***`, or any box-drawing characters (markdown renderers treat those as horizontal rules and float the emoji+heading text to the line-end, breaking the report). Separate every header/recommendation/coverage line from the next with a blank line; consecutive lines without blank separators collapse into one wrapped paragraph. Bold sub-labels in finding blocks (`**🤔 Description**`, `**🔍 Problem code**`, `**💡 Potential solutions**`, `**✅ Recommended solution**`) must each be followed by a blank line before their content — inline-colon labels (`**💡 Why this fix:** …`) are the only exception.

## Maintenance

This skill is repo-scoped to lilnas. The canonical files live at `<repo>/.claude/skills/lilnas-code-review/`. There are currently no Codex or Cursor symlinks — add them if other clients start being used here.

To add a new reviewer persona, drop a file under `reviewers/always-on/` or `reviewers/conditional/` and update Stage 3 in this file with its trigger heuristic. To add a lilnas-specific lens (e.g. discord-bot-conventions, langchain-graph-correctness, drizzle-migration-safety), create the persona file plus a Stage 3 trigger row and a roster-emoji in the "Announce the team" example.
