---
title: Recharts collapses same-day points — a string dataKey makes the X axis categorical
date: 2026-05-30
category: integration-issues
module: swole/stats
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - Multiple progressions logged on the same day render as a single X-axis point
  - The weight-trend line looks flat or overlaps because same-day points stack
  - X-axis ticks are evenly spaced per row instead of proportional to elapsed time
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - recharts
  - charting
  - xaxis
  - time-series
  - datakey
  - scale-time
  - categorical-axis
---

# Recharts collapses same-day points — a string dataKey makes the X axis categorical

## Problem

`WeightTrendChart` plotted a weight time series with `<XAxis dataKey="date">` where `date` was a formatted string. Recharts treats a string dataKey as a **categorical** axis: each unique string is one slot. Two progressions logged on the same calendar day share a date string, so they collapsed into a single X position — same-day progressions disappeared and the axis spaced points by row index rather than by elapsed time.

## Symptoms

- Same-day weight changes render as one point; intra-day progression is invisible.
- The line appears flat or self-overlapping where multiple same-day entries exist.
- A two-week training gap looks the same width as consecutive days, because a categorical axis spaces by slot, not by time.

## What Didn't Work

- An earlier visual-audit pass noticed the chart "looked wrong" but diagnosed it as a **Y-axis** problem (points crammed at the top because the Y domain started at 0) and fixed only the Y domain; it also separately fixed a first-paint blank from `ResponsiveContainer`. Neither touched the categorical X axis — the same-day collapse is a distinct bug and was identified later, in code review. *(session history)*

## Solution

Switch the X axis to a numeric, time-scaled axis keyed on an epoch timestamp, in `apps/swole/src/components/stats/WeightTrendChart.tsx`:

```tsx
type Point = { ts: number; weight: number } // was { date: string; weight: number }

function formatTs(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

<XAxis
  dataKey="ts"
  type="number"
  scale="time"
  domain={['dataMin', 'dataMax']}
  tickFormatter={formatTs}
  // …
/>
<Tooltip labelFormatter={label => formatTs(label as number)} /* … */ />
```

- `type="number"` takes the axis out of categorical mode.
- `scale="time"` spaces points proportionally to real elapsed time.
- `domain={['dataMin', 'dataMax']}` stops the numeric axis from padding out toward zero.
- `tickFormatter` / `labelFormatter` render the epoch back into a readable date for ticks and tooltips.

## Why This Works

Recharts decides axis behavior from the data type of the dataKey, not from visual intent. A string dataKey produces a band/category scale — one slot per distinct value, with duplicates deduped. A numeric dataKey with `type="number"` produces a continuous scale, so two points minutes apart get two distinct, correctly-spaced positions. `scale="time"` additionally makes the spacing reflect calendar distance, so breaks in training read as visual gaps. Keeping the raw `ts` as the key and formatting only at the tick/tooltip layer separates the model (a real instant) from its presentation (a short date label).

## Prevention

- **For any time series in Recharts, key the axis on a numeric timestamp with `type="number"` and `scale="time"`, and format with `tickFormatter` — never key on a pre-formatted date string.** A string axis silently dedupes and reorders.
- **When a field is both the model value and the display label, store the model value and format at render.** Don't bake display formatting into the data the chart consumes.
- **Seed two points on the same day** in the dev fixture so a categorical collapse is visible during development rather than in review.

## Related Issues

- Same code-review batch (commit `88e40cd`): `ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md` and `logic-errors/consistency-percent-window-mismatch-2026-05-30.md`.
