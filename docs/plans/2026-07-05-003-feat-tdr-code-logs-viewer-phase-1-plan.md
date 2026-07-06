---
title: 'feat: tdr-code Logs page — Phase 1: static windowed-read virtualized viewer'
type: feat
status: completed
date: 2026-07-05
origin: docs/brainstorms/2026-07-05-tdr-code-logs-page-requirements.md
deepened: 2026-07-05
---

# feat: tdr-code Logs page — Phase 1: static windowed-read virtualized viewer

## Overview

This is **Phase 1 of 2** for the tdr-code Logs page (see origin: `docs/brainstorms/2026-07-05-tdr-code-logs-page-requirements.md`). It delivers a first-class, authenticated `/logs` page that reads the three append-only pino JSON-lines files as a **static, seek-based, virtualized viewer** — the piece the brainstorm's Next Steps calls "independently shippable" because it alone replaces shelling in to `tail`/`less` for a file already on disk.

Phase 1 builds the two load-bearing primitives everything else composes from:

1. A **windowed byte-offset read endpoint** — the shared backbone (R15) that returns a bounded, line-aligned window around any offset, never loading a whole file. Phase 2's search jump-to-hit reuses it verbatim.
2. A **virtualized, uniform-height list** with bidirectional on-demand windowing and eviction, so a hundreds-of-MB file scrolls smoothly with bounded browser memory (R7, R8, R20).

On top of those it renders each entry as a scannable single line (R12), tolerates malformed/half-written lines (R14), presents the three sources as equal-footing tabs (R2), and opens a detail panel with the full pretty-printed JSON (R13, minus the filter actions, which need Phase 2's filter model).

**What Phase 1 deliberately excludes** (all → Phase 2, `docs/plans/2026-07-05-004-feat-tdr-code-logs-viewer-phase-2-plan.md`): the live append-tail push endpoint and follow/pause/jump-to-latest (R3–R5, F1, F2); whole-file search (R9, R10, F3); structured filters (R11); the detail panel's "filter by this field/value" actions (the rest of R13); the tail-path buffering-off work (R18); and the dedicated frontend-design polish pass. Phase 1 matches the console's existing aesthetic as a baseline, but the interaction-polish pass waits until live/search interactions exist to polish.

> **Phase boundary rationale.** The brainstorm's suggested sequence lists color-coding + detail panel at step 4 (with search/polish). This plan pulls **row rendering with severity color (R12)** and the **detail panel's read half (R13)** forward into Phase 1, because a static viewer that only shows truncated raw rows with no way to read a full entry would not meet the origin's "reads as a first-class part of the console" success criterion, and both are pure read-side rendering with no dependency on live or search. The interactive polish pass and the panel's filter actions stay in Phase 2 where their dependencies live.

U-IDs are continuous across both phase documents: Phase 1 owns **U1–U7**, Phase 2 owns **U8–U15**.

---

## Problem Frame

The `@lilnas/tdr-code` console shows *what the bot is doing* (sessions, status, events) but not *what any process actually logged*. The only way to read logs today is to shell into the host and `tail`/`grep` three pino JSON-lines files under `/tmp/tdr-code/` (resolved via `src/logging/log-paths.ts`), which have **no rotation** — `backend.dev.log` is already ~7 MB / ~45k lines in a single dev session and grows without bound. A naive "read the file into the browser" viewer therefore fails on the steady-state case (arbitrarily large files) and wastes the structured JSON that makes the lines queryable.

Phase 1 makes the on-disk history fully and safely readable from the console: a virtualized viewer backed by seek-based windowed reads, with structured single-line rendering and a JSON detail panel, confined to the three known log files with no arbitrary-path read surface. It is the local/live per-file operator view, complementary to (not a replacement for) the prod Loki/Grafana stack.

---

## Requirements Trace

Phase 1 fully or partially advances:

- R1. Authenticated `/logs` page linked from console nav, matching the dark/dense/monospace aesthetic and hand-built idiom (`cns()`, shared status/empty/error/loading components). — U4, U6
- R2. Per-file tabs with **equal footing** (`backend`, `frontend-server`, `frontend-browser`), each with independent state preserved across switches; empty/absent file shows an empty state, not an error. — U3, U4
- R6. Scroll back through the **entire** file to its first line, loading earlier content on demand in bounded windows. — U2, U5
- R7. The rendered list is **virtualized** — only visible rows in the DOM; uniform row height (R12) keeps arbitrary file sizes smooth. — U5, U6
- R8. The client holds a **bounded window** of lines independent of total file size; far-offscreen content is evicted and reloaded on scroll-back. — U5
- R12. Each entry renders as a single **uniform-height** line: timestamp, level color-coded by severity, source/process badge, `event` slug, `msg`, remaining context as dim `key=val` chips; overflow truncated. — U6
- R13. (Read half) Selecting a line opens a **detail panel** with full, syntax-highlighted, pretty-printed JSON + copy-to-clipboard; dismissible. ("Filter by this field/value" actions → Phase 2 U12.) — U7
- R14. **Malformed / non-JSON lines** (half-written final tail line, stray non-pino line) render as raw text without breaking parsing, virtualization, or search; the next complete line parses normally. — U1, U2, U6
- R15. A **windowed byte-offset read** endpoint returns a bounded, line-aligned window around a requested offset; no read ever loads a whole file into memory. — U2
- R17. All file access **confined to the known log paths** via `log-paths.ts`; the client selects a stream by **name**, never by path; no arbitrary-path read surface. — U1, U2, U3
- R18. (Page + non-tail endpoints half) The page and the read/sources endpoints are covered by the existing global cookie `AuthGuard` — no new auth path. (Tail-endpoint buffering-off → Phase 2 U13.) — U2, U3, U4
- R19. No new secret-leak path: relies on existing write-time redaction + R17 path confinement; the viewer's own backend logs follow the structured-logging convention (registered `event` slug per `info`+ line). — U1, U2
- R20. Rendering and scroll-back stay responsive on a large file (target: smooth into the hundreds of MB); no operation blocks the event loop or main thread in proportion to file size. — U2, U5

**Origin actors:** A1 Operator (guild member on the web console; holds the read/scroll requests), A2 Logs backend (NestJS main process — the only process that can read the files; reads only, never writes), A3 the three append-only pino JSON-lines log files.

**Origin flows:** F2 Scroll back through history (windowed reads to the start of file) — Phase 1's core interactive flow; F4 Inspect one line (detail panel) — Phase 1 delivers the read half. (F1 Watch live, F3 Search → Phase 2.)

**Origin acceptance examples:** AE3 (covers R7, R8, R20 — virtualized, bounded-memory, smooth on a hundreds-of-MB file); AE5 (covers R14 — half-written final line renders as raw, then parses once complete — Phase 1 covers the rendering/parse-tolerance half; the live-completion half is exercised in Phase 2's tail).

---

## Scope Boundaries

- **No live tail / follow** in Phase 1. The viewer reads what is on disk at request time; the append-delta push endpoint, follow-on-by-default, scroll-up-pauses, "N new" badge, and jump-to-latest are Phase 2 (R3–R5, F1, F2).
- **No search** in Phase 1 (R9, R10, F3) and **no structured filters** (R11). The windowed read shows raw byte-windows of *all* lines in file order.
- **Detail panel is read-only in Phase 1.** Full JSON + copy ship now; the "filter by this field/value" actions (rest of R13) ship in Phase 2 with the filter model.
- **No cross-source time-merged timeline** — sources are per-file tabs (equal footing), carried from origin. Deferred indefinitely per origin scope.
- **No log rotation / retention, no editing/clearing/truncating, no download/export, no time-range jump** — all carried from origin scope boundaries; unchanged here.
- **No frontend-design polish pass in Phase 1.** Phase 1 matches the console's existing aesthetic as a competent baseline; the dedicated composition/typography/motion/copy pass is Phase 2 U14.

### Deferred to Follow-Up Work

- Live tail push endpoint + follow/pause/jump-to-latest → Phase 2 (`docs/plans/2026-07-05-004-feat-tdr-code-logs-viewer-phase-2-plan.md`, U8, U10).
- Whole-file server-side search + jump-to-hit → Phase 2 (U9, U11).
- Structured filters (level / process / event) composing with search, and the detail panel's filter actions → Phase 2 (U12).
- Tail-path proxy buffering-off + EventSource 401 fallback → Phase 2 (U13).
- Frontend-design polish pass → Phase 2 (U14).

---

## Context & Research

### Relevant Code and Patterns

- **`apps/tdr-code/src/logging/log-paths.ts`** — exports `LOG_DIR = '/tmp/tdr-code'`, the `LogStream = 'backend' | 'frontend-server' | 'frontend-browser'` union, `logEnvSuffix()`, and `logFilePath(stream)`. This is the **R17 path-confinement primitive and the R2 tab set**: the client selects by `LogStream` name, the server resolves the path. Reuse the union; do not redefine the three names anywhere.
- **`apps/tdr-code/src/console/reconcile.service.ts`** — the closest existing pattern to R14/R15: a seek-based bounded read (`fs.statSync` size guard → `fs.openSync` + `fs.readSync(fd, buf, 0, MAX_JSONL_BYTES, 0)` → **trim to the last `\n`** → parse JSONL line-by-line, **skipping malformed lines**, `try/finally` `fs.closeSync`, `MAX_JSONL_BYTES = 10 MiB`, returns a `cappedAt`). U2 mirrors this for windowed reads.
- **`apps/tdr-code/src/console/jsonl-locator.ts`** — path-confinement precedent (charset allowlist + `path.resolve` + `startsWith(root)` traversal check). The model for "no arbitrary-path read" even though U2 goes further by accepting only a `LogStream` name.
- **`apps/tdr-code/src/console/query-params.ts`** — `parseQuery(schema, raw)` → `BadRequestException(issues[0].message)`; the zod query-param parsing convention (raw string query params coerced by the schema). Precedents: `CursorSchema`/`LimitSchema`.
- **`apps/tdr-code/src/env.ts`** — `EnvKeys` (`as const`) + `env(EnvKeys.X, 'default')` for tunable knobs; the `SSE_*` keys are the precedent for main-process-only window/size knobs (no `buildBotEnv` allowlist entry).
- **`apps/tdr-code/src/console/config.controller.ts` / `.service.ts` / `.dto.ts`** — the thin-controller / injectable-service / zod-DTO trio to mirror for `LogsController` / `LogReaderService`.
- **`apps/tdr-code/src/app.module.ts`** — where a new main-process-only module is wired into `imports` (alongside `SseModule`, `ConsoleModule`, `LoggingModule`); the global `{ provide: APP_GUARD, useClass: AuthGuard }` that protects new routes automatically.
- **`apps/tdr-code/src/app/events/page.tsx`** — the closest frontend analog: a filterable list with a `LEVEL_COLORS` map (`error: text-red-400`, `warn: text-yellow-400`, `info: text-gray-400`), `<select>`/`<input>` filter idiom, and `EmptyState`/`ErrorState`/`LoadingState` usage. Extend `LEVEL_COLORS` for trace/debug/fatal in U6.
- **`apps/tdr-code/src/app/components/nav-shell.tsx`** — `NAV_LINKS` drives the header; add `{ href: '/logs', label: 'Logs' }`. Active styling via `cns()` + `usePathname()`. `<main className="flex-1 px-8 py-10">` is the page container.
- **`apps/tdr-code/src/app/components/{empty,error,loading}-state.tsx`, `status-dot.tsx`** — shared status components to reuse (dashed-border empty/error, centered loading).
- **`apps/tdr-code/src/app/lib/api.ts`** — `request<T>` (`/api` prefix, 401→`/login` latch), `queryKeys` factory, typed `api` method object. Add `queryKeys.logs*` + `api.readLogWindow(...)` / `api.getLogSources(...)` against new DTO types.
- **`apps/tdr-code/src/app/providers.tsx`** — `createQueryClient` (`refetchOnWindowFocus:false`, `staleTime:10_000`, `gcTime:60_000`); `QueryCache.onError` already auto-logs query errors to the browser-log stream, so new queries get error logging for free.
- **`apps/yoink/src/app/(library)/library-grid.tsx`** — the only existing `@tanstack/react-virtual` usage in the monorepo (`^3.13.19`); mirror its `'use client'` + `useVirtualizer` options shape, but **omit its `measureElement` ref** (yoink rows are variable-height media cards; log rows are uniform).
- **`packages/utils/src/cns.ts`** — `cns(...) = twMerge(clsx(...))`; mandated by project CLAUDE.md for class-name combination.

### Institutional Learnings

- **`docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md`** — governs R19. Every `info`+ backend log carries a **registered kebab-case `event` slug** (object-first arg) + a human `msg`; `debug` (level 20) is **exempt and legitimately has no `event`** — so the renderer must treat "no `event`" as valid, not malformed. Add a new `LOGS_*` domain group to `log-events.ts` for the viewer's own backend log lines; keep `log-events.ts` **plane-neutral** (no `@nestjs/*`/`react`/`pino`/`next` imports). Redaction is already applied at write time (`redactionCensor`), so on-disk content is safe to display — Phase 1 adds no logger that re-emits file content.
- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — the "shared framework-free contract both planes import" instinct; `log-paths.ts` and `sse.types.ts` are the realized templates. U1's shared wire-contract module follows this (browser-safe: no `Buffer`/`fs`).
- **Auto-memory `tdr-code-node-version-mismatch`** — `better-sqlite3`'s native binding was built against Node 24.x (ABI 137); the shell default Node 22.x fails `jest`/`tsc` with `NODE_MODULE_VERSION` mismatch. Run DB-backed specs and typechecks with a scoped PATH override, e.g. `env PATH="$HOME/.local/share/nvm/v24.15.0/bin:$PATH" pnpm jest …` (verify the installed v24 ABI is 137 first: `node -e "console.log(process.versions.modules)"`). CI is unaffected. Applies to any Phase 1 spec that constructs the DB test harness — though most Phase 1 backend units read files, not the DB.

### External References

- **TanStack Virtual (`@tanstack/react-virtual`)** — [Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer), ["Chat UIs Are Lists Until They Aren't"](https://tanstack.com/blog/tanstack-virtual-chat). The prepend-without-jump / follow APIs (`anchorTo:'end'`, `followOnAppend`, `scrollToEnd`, `isAtEnd`, `getDistanceFromEnd`) landed in `virtual-core@3.16.0`; the current React adapter `@tanstack/react-virtual@3.14.5` pins core `3.17.3` (includes the anchored-prepend one-frame-jump fix). The version currently resolved in the lockfile is `3.13.19`, which **lacks** these — see Key Technical Decisions.
- **Node.js `fs`** — [fs.watch / filehandle.read / createReadStream / stat](https://nodejs.org/api/fs.html), [string_decoder](https://nodejs.org/api/string_decoder.html). Windowed reads: positioned `filehandle.read(buf, 0, len, position)` into an owned buffer (avoids the `createReadStream` shared-pool aliasing hazard, nodejs/node#24817); `\n` (0x0A) can never appear inside a multi-byte UTF-8 sequence, so newline framing in bytes is safe. `fs.stat().size` is the cheap file-size read for offset mapping.

---

## Key Technical Decisions

- **Windowed-read scheme (resolves origin "Deferred to Planning" [R6, R15]).** Fixed byte-size windows (env-tunable via `EnvKeys`, default ~128 KB), read with a positioned `filehandle.read` into an owned `Buffer` (not `createReadStream`, per nodejs/node#24817). Snap the **start** offset *backward* to the byte after the previous `\n` (or byte 0); extend the **end** *forward* to the next `\n` (or EOF) so a window never splits a JSON line. Boundary-finding is done at the **byte** level (`\n` is UTF-8-safe); only complete lines are decoded to strings. Mirrors `reconcile.service.ts`'s trim-to-last-newline discipline.
- **Virtualization model (resolves [R7, R8]).** The client holds a **bounded sliding window** of parsed lines (an array), each tagged with its `byteOffset`. `@tanstack/react-virtual` virtualizes *that array* (uniform fixed height, no `measureElement`), never the whole file. Scrolling near the top edge fetches the previous byte-window and **prepends**; near the bottom fetches the next and **appends**; far-offscreen lines are **evicted** to bound memory. **Total line count is never needed** — position-in-file is shown as a byte-percentage from `windowStart / fileSize`. Jump-to-offset (Phase 2 search) replaces the window with the one around a target offset. `getItemKey = byteOffset` (globally unique, monotonic, eviction-stable) is the anchor that makes prepend-without-jump work.
- **Add `@tanstack/react-virtual` `^3.14.5` (core `3.17.3`) as a direct tdr-code dependency.** tdr-code does not currently depend on it — only `@tanstack/react-query` — and pnpm's strict workspace isolation means it **cannot** import yoink's copy, so the dependency must be declared in `apps/tdr-code/package.json` (mandatory, not optional). Pin `^3.14.5` (not `^3.13.19`, which is what yoink carries) so `anchorTo:'end'` (prepend/eviction stability), `followOnAppend`/`scrollToEnd`/`isAtEnd` (added in core `3.16.0`, used by Phase 2 U10's follow mode), and the anchored-prepend one-frame-jump fix (core `3.17.x`) are all available. **Version fallback (not a dependency-add fallback):** if the team must pin to `3.13.19` for consistency with yoink, compensate manually for prepend/eviction — `scrollTop += prependedCount * ROW_PX` in a `useLayoutEffect` on prepend, `scrollTop -= evictedCount * ROW_PX` on top-eviction (trivial and reliable because row height is constant) — but note Phase 2 U10 then loses `followOnAppend`/`isAtEnd` and must hand-roll pinned-state tracking too. `^3.14.5` is strongly preferred; the manual path is documented so a version decision never blocks the work. Smoke-test yoink's library grid after the install regardless (it uses only stable options).
- **Timestamp presentation (resolves [R12]).** Rows show **absolute local time** at millisecond precision in a fixed-width column (`HH:mm:ss.SSS`) — logs are scanned for ordering/correlation, where relative time ("2m ago") is useless. The detail panel and the row `title` show full ISO-8601 + UTC. The fixed single-line grid is: `[time] [level] [source/process badge] [event] [msg] [context chips…]`, each column fixed/clipped, overflow truncated with ellipsis. (The existing `RelativeTime` component is intentionally **not** used for log rows.)
- **Open-at-tail default, with a snapshot affordance.** On tab open, the viewer loads the window at the *end* of the file (newest content) and pins to the bottom — the natural static default and the seat Phase 2's follow mode takes over. Because Phase 1 has no live tail, this snapshot looks like `tail -f`'s first frame but does not update, so surface a small "snapshot — refresh for newer" indicator plus a manual refresh control (U5) rather than letting an operator wait for updates that only arrive once Phase 2 ships. Scroll-up walks `before` windows to the start (R6).
- **Read endpoints are plain buffered JSON.** Only the Phase 2 tail needs buffering-off; the window/sources endpoints are ordinary `GET` JSON and need no proxy changes.
- **Malformed-line contract (R14).** A line whose `JSON.parse` throws is carried as `{ byteOffset, raw, parsed: null }` and rendered as raw text; parsing never aborts a window. A window's trailing partial line (no `\n`) is dropped from a `before`/`after` window (the adjacent window owns it); the live-completion case is a Phase 2 tail concern.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Windowed-read data flow (U2):**

```
client scroll near top edge
  → GET /api/logs/window?stream=backend&anchor=<byteOffset>&direction=before&maxBytes=131072
    → LogReaderService:
        path   = logFilePath(assertLogStream(stream))      // R17: name→path, no client path
        size   = fs.stat(path).size
        [start,end] = snapWindow(anchor, direction, maxBytes, size)  // backward to prev \n, forward to next \n
        buf    = filehandle.read(ownedBuffer, 0, end-start, start)   // positioned read, bounded
        lines  = splitAndParse(buf)   // byte-split on \n; JSON.parse each → parsed | null (R14)
    → { stream, fileSize: size, windowStart: start, windowEnd: end,
        atStart: start===0, atEnd: end>=size,
        lines: [{ byteOffset, byteLength, raw, parsed }] }
  → client prepends lines to the bounded window array (anchorTo:'end' holds viewport)
  → react-virtual renders only visible rows (uniform height)
  → far-bottom lines evicted to keep the window bounded
```

**Bounded window lifecycle (U5) — a byte-anchored sliding view, line count never known:**

```
                fileSize (bytes) ─────────────────────────────►
 [0]───────────────[ loaded window: windowStart..windowEnd ]───────────[EOF]
                    ▲ scroll near top → fetch `before`, prepend, evict bottom
                                             scroll near bottom → fetch `after`, append, evict top ▲
 scrollbar position ≈ windowStart / fileSize   (byte-percentage, not row index)
```

**Row grid (U6), uniform fixed height, overflow clipped:**

```
12:03:41.512  INFO   main   generation-inserted   Inserted bot generation   generationId=424
└─ HH:mm:ss.SSS  └─level  └─proc  └─event slug     └─ msg (flex, clipped)    └─ dim key=val chips
(malformed line → single raw cell spanning the row, dim/italic, no columns)
```

---

## Output Structure

New files land beside existing feature folders; the frontend page follows App Router conventions.

    apps/tdr-code/src/
      logging/
        log-view.types.ts          # U1  shared, plane-neutral wire contract + browser-safe parse helper
        log-view.types.spec.ts     # U1
        logs.controller.ts         # U2/U3  GET /logs/window, GET /logs/sources
        logs.controller.spec.ts    # U2/U3
        log-reader.service.ts      # U2  seek-based windowed read + byte-level line snapping
        log-reader.service.spec.ts # U2
        log-sources.service.ts     # U3  stat the three streams for tabs + empty state
        log-sources.service.spec.ts# U3
        logs.dto.ts                # U2/U3  zod query/response DTOs
        logs.module.ts             # U2  main-process-only module (or fold into logging.module.ts)
      app/logs/
        page.tsx                   # U4  /logs page: tabs, per-tab state, layout
        log-viewer.tsx             # U5  virtualized bounded-window list
        log-row.tsx                # U6  uniform single-line row rendering
        log-detail-panel.tsx       # U7  pretty-printed JSON + copy
        __tests__/
          log-viewer.spec.tsx      # U5
          log-row.spec.tsx         # U6
          log-detail-panel.spec.tsx# U7

---

## Implementation Units

- U1. **Shared log-view wire contract + event slugs**

**Goal:** One plane-neutral, browser-safe module defining the window/source request+response shapes and a JSON-line parse-or-raw helper that both the NestJS endpoints and the browser client import, so the two sides cannot drift. Register the viewer's own backend `event` slugs.

**Requirements:** R14, R17, R19

**Dependencies:** None

**Files:**
- Create: `apps/tdr-code/src/logging/log-view.types.ts`
- Create: `apps/tdr-code/src/logging/log-view.types.spec.ts`
- Modify: `apps/tdr-code/src/logging/log-events.ts` (add a `LOGS_*` domain group)
- Modify: `apps/tdr-code/src/logging/log-events.spec.ts` (seed the new slugs)

**Approach:**
- Re-export/reuse `LogStream` from `log-paths.ts` — do not redefine the three names. Define `LogWindowDirection = 'before' | 'after' | 'around'`, `LogLine = { byteOffset: number; byteLength: number; raw: string; parsed: Record<string, unknown> | null }`, `LogWindowResponse = { stream; fileSize; windowStart; windowEnd; atStart; atEnd; lines: LogLine[] }`, and `LogSource = { stream; exists; size }`.
- Include a **browser-safe** pure helper `parseLogLine(raw: string): Record<string, unknown> | null` (a guarded `JSON.parse` returning `null` on failure) — used server-side to fill `parsed` and client-side as a fallback. **No `Buffer`/`fs`/`@nestjs`/`react` imports** (the browser imports this module).
- Byte-level buffer scanning helpers (find previous/next `\n`) are **backend-only** and belong in U2's service, not here — keep U1 browser-safe.
- Add a `LOGS_EVENTS` group to `log-events.ts` with slugs the read/sources services will emit on error paths, e.g. `'log-window-read-failed'`, `'log-source-stat-failed'`. Keep the file framework-free.

**Patterns to follow:** `apps/tdr-code/src/sse/sse.types.ts` (plane-neutral shared contract), `apps/tdr-code/src/logging/log-paths.ts` (Node-stdlib-only discipline), the existing `SSE_EVENTS` group in `log-events.ts`.

**Test scenarios:**
- Happy path: `parseLogLine('{"level":30,"time":1,"msg":"x"}')` returns the object with those fields.
- Edge case: `parseLogLine('')` and `parseLogLine('   ')` return `null`.
- Edge case (R14): `parseLogLine('{"level":30, "msg":')` (half-written) returns `null` without throwing.
- Edge case: a valid line with no `event` field (a `debug`/level-20 line) parses to an object with no `event` key — `parseLogLine` does not invent one.
- Contract: `log-events.spec.ts` asserts the new `LOGS_EVENTS` slugs are present in `LOG_EVENT_VALUES` and match the kebab-case pattern.

**Verification:** `log-events.spec.ts` passes with the new slugs; the module imports cleanly from a browser-context file (no Node-only imports); types compile under both the backend and frontend tsconfig projects.

---

- U2. **Windowed byte-offset read endpoint + reader service**

**Goal:** `GET /api/logs/window` returns a bounded, line-aligned window around a requested byte offset for a named stream, seek-based, malformed-line-tolerant, path-confined — the shared backbone (R15) Phase 2's jump-to-hit reuses.

**Requirements:** R6, R14, R15, R17, R18, R19, R20

**Dependencies:** U1

**Files:**
- Create: `apps/tdr-code/src/logging/log-reader.service.ts`
- Create: `apps/tdr-code/src/logging/log-reader.service.spec.ts`
- Create: `apps/tdr-code/src/logging/logs.controller.ts`
- Create: `apps/tdr-code/src/logging/logs.controller.spec.ts`
- Create: `apps/tdr-code/src/logging/logs.dto.ts`
- Create: `apps/tdr-code/src/logging/logs.module.ts` (or extend `apps/tdr-code/src/logging/logging.module.ts`)
- Modify: `apps/tdr-code/src/app.module.ts` (wire the module into `imports`, main-process-only)
- Modify: `apps/tdr-code/src/env.ts` (add `LOG_WINDOW_MAX_BYTES` default, main-only)

**Approach:**
- Controller (`@Controller('logs')`, `@Get('window')`) parses query params via `parseQuery(LogWindowQuerySchema, req.query)` — `stream` (validated against the `LogStream` union → `BadRequestException` on unknown; this *is* R17: no path input), `anchor` (coerced int ≥ 0, clamp to `[0, fileSize]`), `direction`, optional `maxBytes` (clamped to the env cap). Delegates to `LogReaderService.readWindow(...)`. **Note:** `BrowserLogsController` already declares `@Controller('logs')` with `@Post('browser')`; NestJS allows two controllers on the same prefix when method+path pairs differ (`GET logs/window` vs `POST logs/browser` do not collide), but wire the new `LogsController` alongside it deliberately (both live in `logging.module.ts`) rather than treating `logs` as a greenfield prefix.
- Service resolves `path = logFilePath(stream)` and does a seek-based read mirroring `reconcile.service.ts`: `fs.stat` for size; compute `[start, end]` by snapping `anchor` per `direction` (backward-scan to the byte after the previous `\n` for `start`; forward-extend to the next `\n`/EOF for `end`); positioned `filehandle.read` into an owned `Buffer.alloc(len)`; split the buffer on the `\n` byte; decode + `parseLogLine` each complete line into `LogLine`s with running `byteOffset`; drop a trailing partial line; `try/finally` close the handle.
- Backward-scan reads a small block ending at `anchor` and looks for `\n`; if none, steps back another block (bounded look-back) — never loads the whole file (R15/R20).
- **`around` direction (consumed by Phase 2 U11 jump-to-hit):** center the window on `anchor` — read ~`maxBytes/2` before and ~`maxBytes/2` after, snap the start backward to the byte after the previous `\n` and the end forward to the next `\n`/EOF, and guarantee the line *containing* `anchor` is whole and present so a jumped-to hit is always fully rendered. This branch and a dedicated test ship in Phase 1 even though only Phase 2 consumes it, so U11 does not inherit an untested code path.
- A missing/absent file (`frontend-server`) resolves to `{ fileSize: 0, atStart: true, atEnd: true, lines: [] }`, not an error (feeds R2's empty state).
- On a read error, log `{ event: 'log-window-read-failed', err, stream }` and throw the appropriate Nest exception.

**Execution note:** Start with the pure byte-scanning/snapping helper test-first (given a fixed `Buffer`, assert line-aligned `[start,end]` and correct `LogLine` offsets) before wiring the fs/controller layer — the snapping math is the highest-risk logic and is deterministic to test.

**Patterns to follow:** `apps/tdr-code/src/console/reconcile.service.ts` (seek-read, trim-to-newline, skip-malformed, `try/finally` close), `apps/tdr-code/src/console/jsonl-locator.ts` (path confinement), `apps/tdr-code/src/console/query-params.ts` (zod query parsing), `apps/tdr-code/src/console/config.controller.ts` (thin controller shape).

**Test scenarios:**
- Happy path: a temp file of N known JSON lines; `direction=before` from `fileSize` returns a line-aligned window whose last line is the file's last complete line, with correct `byteOffset`s and `atEnd:true`.
- Happy path: `direction=before` from a mid-file offset returns lines strictly before it, `atStart:false`; walking `before` repeatedly reaches `atStart:true` at byte 0 (R6).
- Edge case: `anchor` landing **mid-line** snaps outward so the window starts/ends on line boundaries — never a split JSON line.
- Happy path (`around`): `direction=around` from a mid-file `anchor` returns a window centered on that offset with the line containing `anchor` whole and present, start/end line-aligned — the jump-to-hit contract Phase 2 U11 depends on.
- Edge case (R14): a file whose final line lacks a trailing `\n` — the partial is dropped from the window; the preceding complete lines parse; no throw.
- Edge case (R14): a stray non-JSON line mid-file yields `{ raw, parsed: null }` and does not abort the window; the next line parses.
- Edge case: empty file → `{ fileSize:0, lines:[], atStart:true, atEnd:true }`; absent file (`frontend-server`) → same, no error.
- Edge case (UTF-8): a line containing a multi-byte character across the nominal window edge decodes intact (byte-level `\n` framing, whole-line decode).
- Error path (R17): `stream=../../etc/passwd` or any value outside the `LogStream` union → `BadRequestException`, no file access attempted.
- Error path: `maxBytes` above the env cap is clamped, not honored; negative `anchor` → `BadRequestException`.
- Covers AE5 (partial-final-line rendering half): the reader tolerates a half-written final line.
- Integration: a large (e.g. 200 MB) generated temp file — a single window read completes in bounded time and memory (assert peak buffer ≤ the window cap, not file size) (R20, AE3 backend half).

**Verification:** windowed reads return correct line-aligned content and offsets across happy/edge/error cases; no read allocates memory proportional to file size; unknown stream names are rejected before any fs call; route returns 401 without an auth cookie (see U-level test hardening carried to Phase 2 U15, but add the 401 assertion here).

---

- U3. **Log sources endpoint (tab bootstrap + empty-state detection)**

**Goal:** `GET /api/logs/sources` returns `{ stream, exists, size }` for all three streams so the frontend can render equal-footing tabs and distinguish "empty/absent file" (empty state) from "error" (R2).

**Requirements:** R2, R17, R18, R19

**Dependencies:** U1

**Files:**
- Create: `apps/tdr-code/src/logging/log-sources.service.ts`
- Create: `apps/tdr-code/src/logging/log-sources.service.spec.ts`
- Modify: `apps/tdr-code/src/logging/logs.controller.ts` (add `@Get('sources')`)
- Modify: `apps/tdr-code/src/logging/logs.controller.spec.ts`

**Approach:**
- For each `LogStream`, `fs.stat` its `logFilePath`; a missing file → `{ exists: false, size: 0 }` (via `ENOENT` catch), never an error. Returns all three in the fixed `LogStream` order so tabs render deterministically.
- Cheap and stateless; no service-layer shaping beyond the stat loop. Log `{ event: 'log-source-stat-failed', err, stream }` only on a non-`ENOENT` stat error.

**Patterns to follow:** `apps/tdr-code/src/logging/log-paths.ts` (iterate the `LogStream` union), `apps/tdr-code/src/console/health.controller.ts` (a thin stat-style read).

**Test scenarios:**
- Happy path: all three files present → three entries with correct `exists:true` and byte sizes in `LogStream` order.
- Edge case (R2): `frontend-server` absent → `{ stream:'frontend-server', exists:false, size:0 }`; other two unaffected.
- Edge case: an empty-but-present file → `{ exists:true, size:0 }` (distinct from absent, though both drive the same empty state).
- Error path: `stat` throwing a non-`ENOENT` error is logged and surfaced as a 500 for that request (not a silent success).

**Verification:** the endpoint returns exactly three entries in a stable order; absent and empty files are represented without errors; route is auth-guarded (401 without cookie).

---

- U4. **`/logs` page shell: tabs, per-tab state, nav link, API wiring**

**Goal:** An authenticated `/logs` App Router page with three equal-footing source tabs, each preserving its own scroll/selection state across switches; nav link; typed react-query hooks + api methods; empty-state handling for absent/empty files.

**Requirements:** R1, R2, R18

**Dependencies:** U1, U3 (needs `/logs/sources`); renders U5 within each tab

**Files:**
- Create: `apps/tdr-code/src/app/logs/page.tsx`
- Modify: `apps/tdr-code/src/app/components/nav-shell.tsx` (add `{ href: '/logs', label: 'Logs' }` to `NAV_LINKS`)
- Modify: `apps/tdr-code/src/app/lib/api.ts` (add `queryKeys.logSources`, `queryKeys.logWindow(...)`, `api.getLogSources()`, `api.readLogWindow(params)` — **`encodeURIComponent` all query params**, per the REVIEW.md footgun)

**Approach:**
- `'use client'` page. `useQuery(queryKeys.logSources, api.getLogSources)` drives the tab bar (labels from the fixed `LogStream` order). Active tab in local state.
- **Per-tab state preservation (R2):** keep each tab's viewer mounted (e.g. render all three but hide inactive via CSS, or lift each tab's window/selection state into a keyed map) so switching away and back preserves scroll position and the open detail row within a session. Choosing mount-all-hide-inactive vs lifted-state is an implementation detail; the contract is "state survives a switch."
- A tab whose source is `exists:false` or `size:0` renders `EmptyState` ("No log entries yet" / "This log file is empty or has not been created"), never `ErrorState`. A `sources` query error renders `ErrorState`.
- Follow the `events/page.tsx` layout scaffold (heading, container, loading/error/empty/data conditionals) and `nav-shell` container spacing.

**Patterns to follow:** `apps/tdr-code/src/app/events/page.tsx` (page composition, conditionals), `apps/tdr-code/src/app/sessions/[id]/page.tsx` (per-view state), `apps/tdr-code/src/app/lib/api.ts` (queryKeys + typed methods), `nav-shell.tsx` (`NAV_LINKS`).

**Test scenarios:**
- Happy path: `sources` returns three streams → three tabs render in order; the first (`backend`) is active by default and mounts the viewer.
- Edge case (R2): switching from `backend` (scrolled mid-history) to `frontend-browser` and back restores `backend`'s scroll position and any open detail row.
- Edge case (R2): the `frontend-server` tab (absent file) shows the empty state, not an error, and is still selectable.
- Error path: a failed `sources` query renders `ErrorState`; individual tab window errors do not blank the whole page.
- Integration: `/logs` is reachable only when authenticated — the middleware cookie-presence gate + API 401 latch redirect to `/login` when unauthenticated (assert the nav link renders for an authed session).

**Verification:** the page matches console chrome (nav, spacing, dark theme); tabs are equal-footing and state-preserving; empty vs error states are correct; `/logs` appears in the nav.

---

- U5. **Virtualized bounded-window list**

**Goal:** Render the active stream as a virtualized, uniform-height list backed by a bounded sliding window of byte-offset-tagged lines: scroll back to the start of file on demand (R6), only visible rows in the DOM (R7), memory bounded regardless of file size (R8), smooth on hundreds of MB (R20).

**Requirements:** R6, R7, R8, R20

**Dependencies:** U2 (windowed read), U4 (host page); U6 renders each row

**Files:**
- Create: `apps/tdr-code/src/app/logs/log-viewer.tsx`
- Create: `apps/tdr-code/src/app/logs/__tests__/log-viewer.spec.tsx`
- Modify: `apps/tdr-code/package.json` (**add** `@tanstack/react-virtual` `^3.14.5` as a direct dependency — tdr-code does **not** currently depend on it, and pnpm's strict workspace isolation means it cannot import yoink's copy, so the dependency must be declared here; this is mandatory, not a fallback)
- Modify: `pnpm-lock.yaml` (regenerated by `pnpm install` after the manifest add)
- Modify: `apps/tdr-code/jest.config.js` (broaden the frontend project's `testMatch` so nested `__tests__` dirs under `src/app/**` are discovered — see Approach)

**Approach:**
- Maintain a bounded array `window: LogLine[]`. Initial load: `readLogWindow({ stream, anchor: fileSize, direction: 'before' })` (open-at-tail); pin to bottom.
- `useVirtualizer({ count: window.length, getScrollElement, estimateSize: () => ROW_PX, getItemKey: (i) => window[i].byteOffset, anchorTo: 'end', overscan: ~12 })`. **No `measureElement`** (uniform height). `getItemKey = byteOffset` is required for prepend stability.
- Edge detection off `getVirtualItems()`: near-top (first visible index ≤ threshold) and not `atStart` → fetch `before`, prepend, evict from the bottom; near-bottom and not `atEnd` → fetch `after`, append, evict from the top. Guard each fetch with an in-flight ref so a sticky edge doesn't refetch. Do prepend/append + eviction as one atomic state update; keep the window > viewport + 2×overscan so eviction never drops a row about to render.
- Prepend viewport stability via `anchorTo:'end'` + stable `getItemKey`; **fallback** (if pinned to 3.13.19): `scrollTop += prependedCount * ROW_PX` in `useLayoutEffect`, and `-= evictedCount * ROW_PX` on top-eviction.
- Position-in-file indicator = `windowStart / fileSize` as a byte-percentage (a thin scrollbar affordance / "top of file" marker at `atStart`).
- Loading older/newer windows shows a subtle inline spinner row, not a full-page `LoadingState`.
- Treat every line as an **immutable append** (avoids react-virtual streaming-drift bug #1218) — lines are never mutated in place; a re-read replaces entries by `byteOffset`.
- **Jest discovery fix:** the frontend jest project (`apps/tdr-code/jest.config.js`) currently matches `**/app/__tests__/**/*.tsx`, which does **not** match specs under `src/app/logs/__tests__/` — those suites would be silently skipped (verified against micromatch). Broaden the frontend project's `testMatch` to a nested glob (e.g. `**/app/**/__tests__/**/*.tsx`, keeping `roots: ['<rootDir>/src/app']`) as part of this unit, so every Phase 1/Phase 2 frontend spec under `src/app/logs/__tests__/` is actually run. (Alternative: place the specs directly under `src/app/__tests__/` — the glob broadening is preferred so the tests live beside their components.)
- **Static-snapshot affordance (Phase 1 only):** because Phase 1 has no live tail, the open-at-tail view is a point-in-time snapshot that looks like `tail -f`'s first frame but never updates. Show a small, unobtrusive "snapshot — refresh for newer" indicator plus a manual refresh control (re-fetch the tail window), so an operator is not misled into waiting for updates that only arrive once Phase 2's follow ships. Phase 2 U10 replaces this affordance with live follow.

**Execution note:** Exercise the windowing/eviction logic with a mocked `readLogWindow` (deterministic fixture windows) so the DOM-node-count and edge-fetch assertions don't depend on a real file.

**Patterns to follow:** `apps/yoink/src/app/(library)/library-grid.tsx` (`'use client'` + `useVirtualizer` options — but omit `measureElement`), TanStack Virtual chat/logs recipe (`anchorTo:'end'`, `getItemKey`, `overscan`).

**Test scenarios:**
- Happy path: given a fixture stream, the viewer renders only the visible rows + overscan (assert DOM row count ≪ total lines) (R7).
- Happy path (R6): scrolling to the top triggers `before` fetches until `atStart`, exposing the file's first line; a "top of file" state shows.
- Edge case (R8): after scrolling far back then forward, the in-memory `window` length stays bounded (assert it never exceeds the cap); evicted lines are re-fetched when scrolled to again.
- Edge case: prepending older lines does not move the currently-visible rows (viewport-stability assertion — via `anchorTo` or the fallback offset math).
- Edge case: rapid scroll does not fire overlapping fetches for the same edge (in-flight guard).
- Edge case: a stream with fewer lines than one window renders fully with `atStart` and `atEnd` both true and no fetch loops.
- Covers AE3: on a large fixture, DOM node count and the in-memory window both stay bounded while scrolling (R7, R8, R20).

**Verification:** only visible rows exist in the DOM; the whole file is reachable by scroll-back; in-memory line count is bounded independent of file size; no scroll jump on prepend; no overlapping edge fetches.

---

- U6. **Uniform single-line row rendering**

**Goal:** Render each `LogLine` as a scannable, uniform-height single line — timestamp, severity-colored level, source/process badge, `event` slug, `msg`, dim `key=val` context chips, overflow truncated — and render malformed/non-JSON lines as raw text without breaking the grid (R12, R14).

**Requirements:** R12, R14

**Dependencies:** U5 (host list); U1 (`LogLine` shape)

**Files:**
- Create: `apps/tdr-code/src/app/logs/log-row.tsx`
- Create: `apps/tdr-code/src/app/logs/__tests__/log-row.spec.tsx`
- Modify: `apps/tdr-code/src/app/events/page.tsx` **only if** extracting `LEVEL_COLORS` into a shared helper (optional; otherwise duplicate-and-extend locally)

**Approach:**
- Fixed-height (`ROW_PX`) flex/grid row. Columns: local `HH:mm:ss.SSS` (from epoch-ms `time`, `title`=full ISO+UTC); numeric-level → label + color (extend `events/page.tsx` `LEVEL_COLORS`: trace/debug `text-gray-500` dim, info `text-gray-300`, warn `text-yellow-400`, error/fatal `text-red-400`); a `process`/source badge (`main`/`bot` for `backend`; the stream name otherwise); the `event` slug (dim if absent — legitimate for `debug`); `msg` (flex, `truncate`); remaining context keys as dim `key=val` chips, clipped to the line.
- **Missing fields are normal:** no `event` (debug lines), no `process` (browser lines) → render gracefully, never "malformed."
- **Malformed line (R14):** `parsed === null` → render `raw` as a single dim/italic monospace cell spanning the row; still fixed-height, still clickable (opens the panel showing raw text).
- Row is a button/`data-track-id` element; clicking selects it (drives U7). Use `cns()` for all class composition (project rule).
- `font-mono`, `text-xs`, dark tokens consistent with existing pages.

**Patterns to follow:** `apps/tdr-code/src/app/events/page.tsx` (`LEVEL_COLORS`, severity styling, `<select>`/badge idiom), existing badge styles in `sessions/[id]/page.tsx`, `packages/utils/src/cns.ts`.

**Test scenarios:**
- Happy path: an `info` backend line renders time (local ms), `INFO` in default color, a `main` badge, the event slug, the msg, and `generationId=424` as a chip.
- Happy path: a `warn` line renders amber; an `error`/`fatal` line red; a `debug` line dim with no event shown and no "malformed" treatment.
- Edge case (R12): a very long `msg` and many context keys stay within one fixed-height line (truncated), not wrapping or growing the row.
- Edge case: a browser line with no `process` renders the stream-name badge instead, no crash.
- Edge case (R14): `parsed:null` (raw `<half json`) renders as a raw dim cell, fixed height, clickable.
- Interaction: clicking a row invokes the selection callback with the line's `byteOffset`.
- Covers AE5 (rendering half): a raw/partial line renders without breaking the row grid.

**Verification:** all levels color correctly; every row is exactly `ROW_PX` tall regardless of content; missing `event`/`process` and malformed lines render cleanly; rows are selectable.

---

- U7. **Detail panel (read half): pretty-printed JSON + copy**

**Goal:** Selecting a row opens a dismissible detail panel showing the full, syntax-highlighted, pretty-printed JSON of that entry with a copy-to-clipboard action, so the structured payload is fully legible on demand without bloating every row (R13 read half, F4).

**Requirements:** R13 (read half), R14

**Dependencies:** U6 (selection), U1 (`LogLine`)

**Files:**
- Create: `apps/tdr-code/src/app/logs/log-detail-panel.tsx`
- Create: `apps/tdr-code/src/app/logs/__tests__/log-detail-panel.spec.tsx`

**Approach:**
- A **side panel** (right-docked — the row grid narrows rather than shrinks vertically, keeping timestamps/levels visible while reading a payload and leaving room for Phase 2's search highlight + jump-to-hit to coexist with an open panel) rendering `JSON.stringify(parsed, null, 2)` with lightweight syntax highlighting (a small hand-rolled tokenizer or a dependency-free highlight; **no heavy new dep** — matches the "hand-built component idiom"). For `parsed === null`, show the `raw` string verbatim.
- **Focus management (this is the app's first modal-like surface — no existing dialog/drawer component to inherit from):** on open, move focus into the panel and trap it while open; on close (button or Esc), return focus to the row that was selected. Keeps keyboard/screen-reader operators oriented instead of dropping focus to `<body>` or a now-hidden row.
- Copy-to-clipboard action (`navigator.clipboard.writeText`) copying the pretty JSON (or raw), with a transient "Copied" affordance.
- Include timestamp in full ISO + UTC and the resolved stream/process for context.
- **"Filter by this field/value" actions are explicitly stubbed/absent in Phase 1** — a code comment marks the seam for Phase 2 U12 (they require the filter model).
- Dismissing returns to a pure uniform-line scan (panel closes, no layout residue). Use `cns()`, `data-track-id`.

**Patterns to follow:** the content-block rendering in `apps/tdr-code/src/app/sessions/[id]/page.tsx`, shared panel/spacing tokens, `packages/utils/src/cns.ts`.

**Test scenarios:**
- Happy path: selecting a parsed line opens the panel with pretty-printed JSON containing all fields; copy writes the same text to the clipboard.
- Edge case (R14): selecting a malformed line shows the raw string, and copy copies the raw text (no `JSON.stringify(null)` artifact).
- Edge case: Esc and the close button both dismiss; re-selecting another row swaps content without stale state.
- Accessibility: opening the panel moves focus into it (and traps it while open); closing (button or Esc) returns focus to the originating row.
- Interaction: the copy affordance shows transient feedback and does not throw if `navigator.clipboard` is unavailable (graceful fallback).

**Verification:** full JSON is legible and copyable on demand; malformed lines show raw; the panel dismisses cleanly; no filter actions are wired (deferred marker present).

---

## System-Wide Impact

- **Interaction graph:** New main-process-only `LogsModule` wired into `AppModule.imports` — must **not** be reachable from `BotModule` (same invariant as `SseModule`/`LoggingModule`; the bot process cannot serve HTTP or own these reads). The global `AuthGuard` (`APP_GUARD`) auto-covers the two new routes; no per-route auth code.
- **Error propagation:** Read/stat failures surface as Nest HTTP exceptions with a registered `event` slug logged; the client's `request()` reads `body.message`. Unknown stream names fail at the DTO boundary before any fs access (R17).
- **State lifecycle risks:** Per-tab client state must survive tab switches (R2). The bounded-window array must be evicted atomically with fetches so `count` and the array never disagree between renders (react-virtual correctness).
- **API surface parity:** New endpoints follow the `console/` controller+DTO+service convention and the `api.ts` typed-method + `queryKeys` convention; new query keys get error-logging for free via the existing `QueryCache.onError`.
- **Integration coverage:** The windowed read on a real large file (event-loop/memory behavior) and the virtualization DOM-node/memory bounds are the cross-layer behaviors unit mocks won't prove — covered by the large-fixture scenarios in U2/U5.
- **Unchanged invariants:** The existing `/api/stream` DB-signal SSE is untouched (Phase 1 adds no streaming endpoint). `log-paths.ts`, `log-events.ts` (plane-neutrality), and the pino write-time redaction are consumed as-is, not modified beyond adding a `LOGS_*` slug group. No log file is ever written by the viewer (A2 reads only).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `@tanstack/react-virtual` bump (3.14.5) unexpectedly affects the yoink grid (shared `^3.13.19`). | Bump is in-range; yoink uses only stable options (`count`/`estimateSize`/`overscan`/`measureElement`). Smoke the yoink library grid after the lockfile update; the 3.13.19 manual-offset fallback is documented if the bump must be reverted. |
| Byte-offset→line-boundary snapping bug splits a JSON line (garbled row / wrong offset). | Test-first pure snapping helper (U2 execution note) with fixed-buffer fixtures; mirror the proven `reconcile.service.ts` trim-to-newline discipline; byte-level `\n` framing (UTF-8-safe). |
| Virtualization scroll-jump on prepend / drift on eviction. | `anchorTo:'end'` + stable `getItemKey=byteOffset` (research-validated); immutable-append lines to avoid bug #1218; explicit viewport-stability test. |
| A window that touches EOF races the growing file (size stale between stat and read). | Treat `bytesRead < requested` as "current EOF," not an error; `atEnd` derived from the read, not a prior stat. |
| Local test/typecheck failure from the `better-sqlite3` Node-ABI mismatch. | Run specs/`tsc` with the Node 24 PATH override (see Institutional Learnings); most Phase 1 backend units read files, not the DB, but the harness may still load it. |
| Detail-panel syntax highlighting tempts a heavy dependency. | Hand-rolled/dependency-free highlight per the console's hand-built idiom; no new runtime dep. |

---

## Open Questions

### Resolved During Planning

- **Windowed-read window size & offset snapping** — fixed byte windows (env-tunable, ~128 KB default), backward-snap start / forward-extend end at the byte level. (Origin [R6, R15].)
- **Virtualization approach** — bounded byte-anchored sliding window virtualized with `@tanstack/react-virtual` 3.14.5, uniform height, `getItemKey=byteOffset`, `anchorTo:'end'`; no global line count. (Origin [R7, R8].)
- **Timestamp presentation** — absolute local `HH:mm:ss.SSS` in rows, full ISO+UTC in the panel/title. (Origin [R12].)
- **Detail panel scope in Phase 1** — read half (JSON + copy) ships; filter actions deferred to Phase 2.

### Deferred to Implementation

- Exact `ROW_PX`, `overscan`, window byte size, edge-fetch threshold, and eviction cap — tune against the real `backend.dev.log` during implementation (uniform height makes these safe to tune late).
- Whether to preserve per-tab state via mount-all-hide-inactive vs a lifted keyed state map — pick during U4 based on which keeps the virtualizer's scroll element stable across switches. Resolve the detail panel's visible behavior *during* a switch (stay open showing the prior tab vs close-and-restore-on-return) alongside this.
- The precise syntax-highlight tokenizer for the panel — trivial and non-load-bearing; decide in U7.
- Keyboard row-to-row navigation (arrow keys / `j`-`k`) and Enter-to-open — U6 makes rows click-selectable; a keyboard binding is a small optional enhancement to decide in U6 (Phase 2 U11 hit-stepping shares this decision).
- The concrete rendering of the byte-percentage position indicator (native scrollbar thumb vs custom overlay vs a "% through file" readout) — the model is fixed (`windowStart / fileSize`); the visual treatment is decided in U5, refined in Phase 2 U14.

### Deferred to Phase 2

- Tail mechanism (`fs.watch` vs polling), partial-final-line live completion, truncation/inode handling (origin [R5, R16]) → Phase 2 U8.
- Search implementation (streaming scan, substring/regex, cursor-paginated offsets) (origin [R9, R10]) → Phase 2 U9.
- Tail-endpoint buffering-off across the proxy hops (origin [R18, R20]) → Phase 2 U13.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-05-tdr-code-logs-page-requirements.md](../brainstorms/2026-07-05-tdr-code-logs-page-requirements.md)
- **Phase 2 plan:** docs/plans/2026-07-05-004-feat-tdr-code-logs-viewer-phase-2-plan.md
- Related code: `apps/tdr-code/src/logging/log-paths.ts`, `apps/tdr-code/src/console/reconcile.service.ts`, `apps/tdr-code/src/console/jsonl-locator.ts`, `apps/tdr-code/src/app/events/page.tsx`, `apps/yoink/src/app/(library)/library-grid.tsx`
- Convention: `docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md`
- External: [TanStack Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer), [Node fs docs](https://nodejs.org/api/fs.html), [Node string_decoder](https://nodejs.org/api/string_decoder.html)
