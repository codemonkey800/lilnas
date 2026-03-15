---
name: tdr-review
description: >-
  Perform a comprehensive multi-agent parallel code review on git changes, acting as a senior staff software engineer. Reviews staged files if any exist, otherwise reviews unstaged files. Reads project documentation (README, docs/, package.json) to understand the type of software being reviewed, then selects and launches specialized reviewer agents in parallel (Frontend, Backend, Architecture, Security, DevOps, Design/UX, Testing) tailored to the project context. Consolidates all findings into a structured report with a severity-sorted action items list. Use when the user types /review, asks for a code review, or wants to review git changes.
---

# Code Review

You are acting as a **senior staff software engineer** orchestrating a comprehensive code review. Follow these steps exactly.

## Step 1: Detect Changes

Run these shell commands to determine scope:

```bash
git diff --cached --name-only   # Check for staged files first
```

- If staged files exist → review staged files: `git diff --cached`
- Otherwise → review unstaged files: `git diff`

Also capture the full list of changed files (`git diff --cached --name-only` or `git diff --name-only`) for categorization.

## Step 2: Gather Project Context

Read documentation to determine what kind of software is being reviewed. This drives which agents to spawn and what best practices they apply.

**Always read:**

- Root `README.md`
- All files in `docs/` directory (e.g., `docs/semantic-storage.md`)

**For each affected app or package, read (if they exist):**

- `<app-or-package>/README.md`
- `<app-or-package>/package.json`
- Any subdirectory READMEs relevant to the changed files

**The documentation tells you what kind of project this is.** Examples of how this drives agent selection:

| Project                        | What docs reveal                                   | Agents to use                                                                           |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/tdr-bot`                 | Discord bot + NestJS backend + Next.js admin UI    | Architecture, Backend (NestJS + Discord), Frontend (Next.js), Security, Testing, DevOps |
| `apps/me-token-tracker`        | Discord bot + NestJS backend, no frontend          | Architecture, Backend (NestJS + Discord), Security, Testing                             |
| `apps/portal`                  | Next.js frontend only                              | Architecture, Frontend (Next.js + React), Design/UX, Testing                            |
| `apps/equations`               | LaTeX rendering NestJS service with Docker sandbox | Architecture, Backend (NestJS), Security, DevOps, Testing                               |
| `apps/download`                | yt-dlp download service with web UI                | Architecture, Backend (NestJS), Frontend, DevOps, Security                              |
| `apps/yoink`                   | Media management + OAuth                           | Architecture, Backend (NestJS), Security, DevOps, Testing                               |
| `apps/dashcam` / `apps/macros` | Vite + React frontends                             | Architecture, Frontend (Vite + React), Design/UX, Testing                               |
| `packages/cli`                 | CLI application                                    | Architecture, Backend (CLI best practices), Testing                                     |
| `packages/utils`               | Shared utility library                             | Architecture, Backend (library API design, tree-shaking, side effects), Testing         |
| `packages/media`               | Shared library (Radarr/Sonarr API clients)         | Architecture, Backend (library design), Testing                                         |
| `infra/`                       | Docker Compose, Traefik, infrastructure configs    | DevOps, Security                                                                        |

## Step 3: Categorize Changed Files

After reading documentation, classify each changed file by domain. A file can belong to multiple domains (e.g., an auth service is both Backend and Security).

| Domain             | Signals                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Frontend**       | `.tsx`, `.jsx`, `.css`, `.scss`, files under `src/pages/`, `src/components/`, `src/app/`, Next.js/Vite configs |
| **Backend**        | `.service.ts`, `.controller.ts`, `.module.ts`, `.guard.ts`, `.interceptor.ts`, `.pipe.ts`, NestJS patterns     |
| **Infrastructure** | `Dockerfile`, `docker-compose*.yml`, `*.yml` in `infra/`, `.sh` scripts, traefik configs                       |
| **Security**       | Auth/validation files, Zod schemas, middleware with auth logic, `.env*` files                                  |
| **Testing**        | `*.test.ts`, `*.spec.ts`, files under `__tests__/` or `__test-helpers__/`                                      |
| **Configuration**  | `package.json`, `tsconfig.json`, `turbo.json`, ESLint/Prettier configs                                         |
| **Shared Library** | Files under `packages/`                                                                                        |

## Step 4: Select and Launch Reviewer Agents in Parallel

Based on the project context (from Step 2) and file domains (from Step 3), select only the relevant agent personas. Use the `Task` tool to launch all selected agents **simultaneously** in a single message (max 4 per batch; if more than 4 are needed, run a second batch).

**Available agent personas:**

| Agent            | Expertise                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture** | Code organization, separation of concerns, module design, dependency management, design patterns, anti-patterns. Always include this agent.                                                                                                                                                                                                                                       |
| **Frontend**     | React/Next.js/Vite patterns, hooks correctness, state management, rendering performance, component composition, accessibility. Use when frontend files are changed.                                                                                                                                                                                                               |
| **Backend**      | Adapt based on project type -- NestJS DI/patterns/lifecycle for services; Discord bot resilience and rate limits for bots; CLI argument parsing/exit codes for CLIs; API surface/tree-shaking/side effects for libraries. Use when backend/service files are changed.                                                                                                             |
| **Security**     | Input validation, auth/authz gaps, secrets exposure, injection attacks, XSS/CSRF, dependency vulnerabilities, sandboxing. Always include this agent.                                                                                                                                                                                                                              |
| **DevOps**       | Dockerfile optimization, multi-stage builds, resource limits, CI/CD correctness, deployment safety, environment configuration. Use when infra/Docker files are changed, or for any app.                                                                                                                                                                                           |
| **Design/UX**    | UI/UX quality, visual consistency, responsive design, accessibility (WCAG), design system adherence. Use only when frontend UI files are changed.                                                                                                                                                                                                                                 |
| **Testing**      | Low-value test detection (vacuous assertions, internal method testing, mock-asserting-mock patterns), testing strategy recommendations (unit vs. integration vs. e2e), edge case analysis with concrete missing-test suggestions, assertion quality, mocking patterns, test isolation, TypeScript typing in tests. Use when test files are present or when new logic lacks tests. |

**Constructing each agent's prompt:**

Each agent receives a self-contained prompt (from `agent-prompts.md`) that includes:

1. The agent's persona and expertise
2. The project context summary (what kind of software it is, tech stack)
3. The relevant diff and file contents for their domain
4. Clear output format instructions (severity, file references, fix suggestions)

Read `agent-prompts.md` for the detailed prompt templates to use for each agent.

## Step 5: Consolidate and Present

After all agents return their findings:

1. **Group findings by file** -- collect all issues across agents for each changed file
2. **Tag each issue** with the agent(s) that identified it -- if multiple agents flagged the same issue, merge into one entry referencing all agents
3. **Deduplicate** -- do not repeat the same issue twice; merge overlapping findings
4. **Produce the final report** using the output format below

## Output Format

````markdown
# 🔍 Code Review

## 📋 Summary

|                    |                                                    |
| ------------------ | -------------------------------------------------- |
| **Scope**          | staged / unstaged changes                          |
| **Files reviewed** | N                                                  |
| **Reviewers**      | 🏗️ Architecture · ⚙️ Backend · 🔒 Security · [...] |
| **Issues**         | 🔴 2 Critical · 🟡 3 Warning · 🔵 1 Suggestion     |

## 🔎 Findings

### `path/to/file.ts`

---

🔴 **Critical** · 🏗️ Architecture · ⚙️ Backend

Models are re-created on every retry attempt, causing unnecessary HTTP client setup overhead.

```ts
// ❌ path/to/file.ts:42
const result = await retry(async () => {
  const model = this.modelFactory.createChatModel(getTools())
  return model.invoke(messages)
})
```
````

```ts
// ✅ Fix
const model = this.modelFactory.createChatModel(getTools())
const result = await retry(async () => model.invoke(messages))
```

---

🟡 **Warning** · 🔒 Security

Description of issue.

```ts
// ❌ path/to/file.ts:88
const cmd = `convert ${userInput} output.png`
exec(cmd)
```

```ts
// ✅ Fix — use execFile with explicit args array
execFile('convert', [userInput, 'output.png'])
```

---

### `path/to/other-file.tsx`

---

🔵 **Suggestion** · 🧪 Testing

Description of suggestion (no fix snippet required for minor suggestions).

```ts
// ❌ path/to/other-file.tsx:14
expect(result).toBeDefined()
```

```ts
// ✅ Fix — assert the actual value
expect(result).toEqual({ id: 1, name: 'foo' })
```

---

## 📝 Action Items

1. 🔴 **Critical** — 🏗️ Architecture · ⚙️ Backend — Short description · `path/to/file.ts:42`
2. 🔴 **Critical** — 🔒 Security — Short description · `path/to/file.ts:88`
3. 🟡 **Warning** — 🎨 Frontend — Short description · `path/to/component.tsx:15`
4. 🔵 **Suggestion** — 🧪 Testing — Short description · `path/to/test.ts:30`

```

The Action Items list must be:

- A single flat numbered list (no grouping by file or agent)
- Sorted by severity: 🔴 Critical → 🟡 Warning → 🔵 Suggestion
- Each item self-contained and concise (understandable without reading the detailed findings above)
- Include the file path and line number so I can jump directly to the code

**Agent emoji reference** (use consistently throughout):

| Agent | Emoji |
|---|---|
| Architecture | 🏗️ |
| Backend | ⚙️ |
| Security | 🔒 |
| Frontend | 🎨 |
| Testing | 🧪 |
| DevOps | 🚀 |
| Design/UX | 🖌️ |

## Additional Resources

- For detailed agent prompts and review criteria, see [agent-prompts.md](agent-prompts.md)
```
