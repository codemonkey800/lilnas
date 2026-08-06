---
title: Drawer re-pushes a browser history marker on every keystroke, breaking Back
date: 2026-05-30
category: ui-bugs
module: swole/stats
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - The browser/hardware Back button stops closing the drawer and navigates away or needs many presses
  - Every keystroke in the drawer's search field silently pushes a new window.history entry
  - Closing via backdrop, Esc, or selecting a row strands a phantom history entry
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - react
  - useeffect
  - useref
  - history-api
  - popstate
  - stale-closure
  - effect-dependencies
  - drawer
---

# Drawer re-pushes a browser history marker on every keystroke, breaking Back

## Problem

`ArchivedRoutinePicker` pushes a `history.pushState` marker when it opens so the browser/hardware Back button closes the drawer instead of navigating away (requirement R8). The `popstate` effect listed the parent's `onClose` callback in its dependency array. The parent re-renders on every search keystroke (its `query` state drives the search box) and recreated `onClose` each render, so the effect tore down and re-ran on every keystroke — pushing a fresh history marker each time. Within a few characters the history stack filled with phantom drawer-marker entries and Back no longer mapped to a single dismiss.

## Symptoms

- The Back button no longer closes the drawer in one press — it takes several, or navigates somewhere unexpected.
- Typing in the search field silently grows `window.history` by one entry per character.
- Dismissing via backdrop tap, Esc, or selecting a routine leaves the pushed marker behind (a "phantom" entry), so the next Back press is consumed by the leftover marker instead of doing what the user expected.

## What Didn't Work

- **Wrapping `onClose` in `useCallback` in the parent.** Considered and rejected: the parent re-renders on every keystroke (it owns the search `query` state), so a parent-side `useCallback` would itself need a stable dependency set, pushing the stability burden onto every call site and creating a cascade. It also would not have fixed the second failure mode below. *(session history)*
- **Fixing only the keystroke re-push.** The code review surfaced this as two separate findings. Stopping the re-push alone still left orphan history entries whenever the drawer closed by any path other than a `popstate` event. *(session history)*

## Solution

Two coordinated changes in `apps/swole/src/components/stats/ArchivedRoutinePicker.tsx`:

1. **Hold `onClose` in a ref** updated on every render, so the `popstate` effect can depend only on `[open]` and never re-subscribes on keystrokes.
2. **Track whether the close came from `popstate`.** On cleanup, if it did *not* (backdrop/Esc/select), call `history.back()` to consume the marker that open pushed — so non-Back dismissals don't strand an entry.

```tsx
// Keep the latest onClose in a ref so the popstate effect depends only on
// [open] — prevents re-pushing a history marker on every search keystroke.
const onCloseRef = useRef(onClose)
useEffect(() => {
  onCloseRef.current = onClose
})

useEffect(() => {
  if (!open) return
  let popped = false
  history.pushState({ drawerOpen: true }, '')
  const handlePop = () => {
    popped = true
    onCloseRef.current()
  }
  window.addEventListener('popstate', handlePop)
  return () => {
    window.removeEventListener('popstate', handlePop)
    if (!popped) history.back()
  }
}, [open]) // ← was [open, onClose]
```

## Why This Works

A React effect re-runs whenever any dependency changes by identity. `onClose` was a fresh function reference on each parent render, so listing it made the effect lifecycle track *every* render, not just open/close transitions. Routing the callback through a ref decouples "the latest handler" from "when the listener is (re)installed": the listener is installed once per open and reads the current handler at fire time.

The `popped` flag closes the second gap. `pushState` adds exactly one entry on open, and exactly one of two paths removes it: a real Back press (`popstate` fires; the entry the browser popped is already gone, so cleanup must *not* pop again) or any other dismissal (cleanup calls `history.back()` to pop the entry we added). The stack is always left balanced.

## Prevention

- **Never put an unstable callback prop in an effect dependency array when the effect has setup/teardown side effects** (event listeners, `pushState`, subscriptions, timers). Route it through a ref, or the effect will churn on every parent render.
- **Any code that pushes a history entry must own its removal on every close path**, not just the Back path. Pair each `pushState` with a cleanup that pops it unless the pop already happened.
- **Test the keystroke path, not just open/close.** A regression test that types several characters and asserts `window.history.length` is unchanged (and that one Back press dismisses) would have caught this.

## Related Issues

- Same code-review batch (commit `88e40cd`): `logic-errors/consistency-percent-window-mismatch-2026-05-30.md` and `integration-issues/recharts-categorical-axis-same-day-collapse-2026-05-30.md`.
