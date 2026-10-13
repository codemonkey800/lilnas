'use client'

import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Room-wide video queue state (PLAN.md "F6" / ORCHESTRATE.md §1's
// "src/playback/queue.ts" contract). A small, single-purpose store — separate
// from `playback/store.ts` (551 lines, singleton-heavy, and about the shared
// <video> element rather than room state) — matching the one-new-store-
// per-feature convention `voice/store.ts` already follows.
//
// Written ONLY by `sync.ts`'s socket handlers, via `useQueueStore.setState()`
// — no action creators live on the state shape itself, so there's no typed
// way to mutate this store from anywhere else. UI components (later units,
// F7a/F7b) only ever read it via the `useQueueStore()` hook and command
// changes through `sync.ts`'s `command*` emitters instead.
//
// `queue` and `currentEntryId`/`currentItemId` are written independently, by
// two different handlers in `sync.ts` — `queue:state` only ever carries
// `{ queue }` on the wire, while `currentEntryId`/`currentItemId` arrive on
// `video:state` (ORCHESTRATE.md §1). That split mirrors why the backend uses
// two separate events in the first place: the queue array changes far less
// often than transport state, and folding both into one message would
// re-send the whole queue on every play/pause/seek.
// ---------------------------------------------------------------------------

// Keep in sync with src/presence/queue.ts's `QueueEntry` / ORCHESTRATE.md §1's
// wire contract. Hand-mirrored rather than imported — this app's established
// convention for crossing the frontend/backend boundary (see
// multiplayer/store.ts's "hand-duplicated wire types" comment) — so a
// NestJS-decorator-laden module never has a path into the Next.js bundle
// graph.
export type QueueEntry = {
  entryId: string // server-generated randomUUID — NOT the itemId
  itemId: string // Emby item id (a movie, or an episode)
  title: string
  subtitle: string | null // "2019" for a film, "The Bear · S2E4" for an episode
  imageTag: string | null
  runTimeTicks: number | null
  addedBy: string // username, from the socket's session — never client-supplied
}

export type QueueStore = {
  queue: QueueEntry[]
  currentEntryId: string | null
  currentItemId: string | null
}

export const useQueueStore = create<QueueStore>(() => ({
  queue: [],
  currentEntryId: null,
  currentItemId: null,
}))
