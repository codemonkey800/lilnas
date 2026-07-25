// MVP is a single hard-coded room (ORCHESTRATE.md §1) — multi-room support
// can be layered on later without reshaping any of the wire events.
export const THEATER_ROOM = 'main'

// keep in sync with CharacterSelect/characters.ts (the `CHARACTERS` ids).
// There's no shared module bridging frontend and backend here, so this list
// is hand-mirrored — same convention this app already uses between
// `emby.service.ts`'s DTOs and `IpadBrowser.tsx`. This is the single source
// of truth: `VALID_CHARACTER_IDS` below and the `characterId` enum in
// `presence.schema.ts` both derive from this exact array, so the two can
// never drift independently.
export const VALID_CHARACTER_ID_LIST = [
  'master-chief',
  'kanna',
  'anis',
  'ghost',
  'xxxtentacion',
  'tamara',
  'charlie',
] as const

// The exact export ORCHESTRATE.md §1 names ("VALID_CHARACTER_IDS Set
// mirroring CHARACTERS ids").
export const VALID_CHARACTER_IDS: Set<string> = new Set(VALID_CHARACTER_ID_LIST)

// ---------------------------------------------------------------------------
// Rate-limit floors — per-socket minimum interval (ms) between ACCEPTED
// messages of each kind. This is a cheap flood guard, not a fairness/QoS
// scheduler (PLAN.md "B3"): the gateway tracks the last-ACCEPTED timestamp
// per socket per message kind and silently drops anything arriving before
// its floor has elapsed, without ever disconnecting the socket over it.
// ---------------------------------------------------------------------------

// Clients broadcast presence at ~13 Hz, i.e. every ~77ms (ORCHESTRATE.md
// §1). 50ms sits comfortably below that period — ~27ms of slack for network
// jitter/timer drift — so no legitimate frame is ever dropped, while still
// capping a flooding client to at most 20 accepted presence updates/sec.
export const PRESENCE_MIN_INTERVAL_MS = 50

// The tablet mirror updates at ~10 Hz while open, i.e. every ~100ms
// (ORCHESTRATE.md §1 / PLAN.md "TB1"). 70ms leaves similar slack to the
// presence floor above.
export const TABLET_STATE_MIN_INTERVAL_MS = 70

// ICE candidates trickle in bursts during WebRTC negotiation — several can
// legitimately fire within a few ms of each other — so this floor is
// deliberately far looser than the other two. It's applied to the whole
// `rtc:signal` message (offer/answer included, not just `kind: 'ice'`)
// since an offer/answer only fires once or twice per connection anyway, so
// sharing one generous floor keeps the bookkeeping simple without
// meaningfully weakening the flood guard.
export const RTC_ICE_MIN_INTERVAL_MS = 20
