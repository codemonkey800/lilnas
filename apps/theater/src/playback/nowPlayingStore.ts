'use client'

import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Room-wide "what's playing" state (ORCHESTRATE.md §1). A small,
// single-purpose store — separate from `playback/store.ts` (singleton-heavy,
// and about the shared <video> element rather than room state) — matching the
// one-new-store-per-feature convention `voice/store.ts` already follows.
//
// Written ONLY by `sync.ts`'s `video:state` handler, via
// `useNowPlayingStore.setState()` — no action creators live on the state
// shape itself, so there's no typed way to mutate this store from anywhere
// else. UI components only ever read it via the hook and command changes
// through `sync.ts`'s `command*` emitters instead.
// ---------------------------------------------------------------------------

// Keep in sync with src/presence/video.schema.ts's `NowPlayingEntry` /
// ORCHESTRATE.md §1's wire contract. Hand-mirrored rather than imported —
// this app's established convention for crossing the frontend/backend
// boundary (see multiplayer/store.ts's "hand-duplicated wire types" comment) —
// so a NestJS-decorator-laden module never has a path into the Next.js bundle
// graph.
export type NowPlayingEntry = {
  entryId: string // server-generated randomUUID, one per load — NOT the itemId
  itemId: string // Emby item id (a movie, or an episode)
  title: string
  subtitle: string | null // "2019" for a film, "The Bear · S2E4" for an episode
  imageTag: string | null
  runTimeTicks: number | null
  addedBy: string // username, from the socket's session — never client-supplied
}

export type NowPlayingStore = {
  entry: NowPlayingEntry | null
}

export const useNowPlayingStore = create<NowPlayingStore>(() => ({
  entry: null,
}))
