# Download App — Unified Media Experience Spec

*Formalized from voice notes, 2026-08-06.*

lilnas's download app is a single interface for acquiring and managing three kinds of media: **videos** (arbitrary URLs — YouTube, Instagram, TikTok, etc. — via yt-dlp), **movies** (via Radarr), and **shows** (via Sonarr). Downloads land on the lilnas server by default, not the requesting user's device — saving locally is a separate, explicit action (§9).

## Core Concepts

**Attribution model**
- Movies and shows are always attributed to the requesting user — no toggle, by design.
- Videos are the only media type with an optional per-download toggle to hide the requester's identity.
- A hidden attribution is hidden from other regular users only. **Admins can always see the true requester**, regardless of the toggle.
- Attribution renders as the requester's avatar everywhere the media appears — gallery, downloads-activity page, detail pages/cards — with a tooltip (or equivalent metadata) revealing who downloaded it.

**Playback model**
- **Videos** are the only media type with an in-app playable experience.
- **Movies and shows** hand off to Emby instead: "Watch" navigates to the item in Emby once Emby has indexed the downloaded file. If Emby hasn't picked it up yet, the UI shows an "Indexing…" state rather than a Watch action.
- *Implementation note:* there's no live Emby API integration in the codebase today (verified). One existed previously in the `theater` app — a backend `EmbyModule` resolving library items and stream URLs, session-gated via the existing auth cookie (commit `9c665e1`) — but that source is no longer in the working tree, so treat it as a reference pattern to dig up from git history, not a ready import.

**Navigation model**
- Selecting any movie/show surface — a nav-bar or dedicated-search result (§3), a gallery card (§7), or the homepage's Recently Added card (§1) — always opens that title's detail page (§4 or §5). Downloading (or deleting, replacing, flagging a file) only ever happens from the detail page; no list or card surface exposes those actions directly.
- **Exception, video links only:** a raw video link has no Radarr/Sonarr-style release picker to choose from, so the nav-bar field surfaces a Download action directly, without a detail-page stop first. It still only *navigates* — the download itself starts on the video's detail page (§8), same as every other media type.

**Entry-point model**
- The nav-bar field, present on every page, is the single entry point for both jobs: paste a video link, or search for a movie or show by title. The homepage carries no input of its own (§1).
- **On mobile**, the field competes with the doorplate, the live-download status, and the account avatar for a single row it can't fit into inline, so it collapses to a search icon. Tapping it expands the field to take over the bar full-width, in the exact same states described below; closing it, or a redirect firing, hands the bar back. Desktop has room for the field inline at all times — no collapse, no tap required.
- On every change, classify the current text as a **URL** or **not a URL**:
  - Parses as a URL (a bare `host/path` like `youtube.com/watch?v=…` counts — a scheme isn't required, an `https://` is assumed).
  - Anything else — including a URL-shaped string that still fails to parse a host — is not a URL.
- Classification is a client-side check only — a result never fires a network request from the field itself.
- **URL branch:** the icon swaps and a compact Download button appears inline, in the pill itself — no dropdown, no preview card. Clicking Download navigates to the video's detail page (§2, §8), where extraction and the download both start.
- **Anything else** is treated as a title search. Once it clears 2+ characters — the same threshold §3's search itself uses — a compact Search button appears inline, the same treatment as the Download button: icon tints, button appears in the pill, no dropdown, no results shown in the field itself. Pressing Enter does the same thing as clicking Search, so neither typing style is required. Either one navigates to the dedicated search page (§3) with results already loading.

## 1. Homepage
- Overview of the library: a glimpse of available videos, movies, and shows.
- Quick-access entry points to browse movies, browse shows, view your video library, or jump to downloads activity.
- No input lives on this page — pasting a link or searching a title both happen in the nav-bar field (Entry-point model, Core Concepts), present here and on every other page.
- Recently added items link to their detail page (§4, §5, or §8) exactly like a gallery or search result does — see the Navigation model under Core Concepts.

## 2. Video Downloads
1. User pastes a URL into the nav-bar field (Entry-point model, Core Concepts), reachable from every page.
2. Once the field recognizes the text as a link, a compact Download button appears inline — no preview, no separate resolving state (see Entry-point model). Clicking it navigates to the video's detail page (§8), where the download starts: yt-dlp extraction, metadata, progress, cancel, and **pause** controls all render there, with no separate status page to navigate to. If yt-dlp doesn't recognize the link, the detail page shows a "not recognized" state instead (§8).
3. On completion, the user can watch the video in-app or save it locally (§9).

**Pause/resume — verified feasible.** The app already spawns yt-dlp as a child process and cancel already calls `proc.kill()` (Node's default SIGTERM) without deleting any files — that's exactly the primitive pause needs. Confirmed live: throttled a download, sent SIGTERM at 123,625 of 614,433 bytes, then re-ran the identical yt-dlp command — it printed `Resuming download at byte 123625` and finished by transferring only the remaining ~20%, not re-fetching from zero. No flag changes needed; yt-dlp's default `--continue`/`.part` behavior already does this.

- *Implementation note:* this needs a new `Paused` job status (distinct from `Cancelled`) and a `resumeVideoDownloadJob` counterpart to the existing `cancelVideoDownloadJob` that re-enters `download()` for the same job/working directory instead of finalizing it.
- *Caveat:* verified against a simple progressive format (yt-dlp resolved `-f worst` to itag 18). The app doesn't currently force a format, so a default/best-quality YouTube grab may resolve to fragmented DASH streams, which resume via a different (also well-supported, but unverified here) per-fragment mechanism. Worth a quick confirmation against whatever format selection ships before calling this fully closed.

## 3. Movie & Show Discovery
- Search by title, year, cast, or genre — via the nav-bar search field, present on every page, and/or the dedicated search page. Both are entry points into the same search, not separate implementations; the homepage no longer participates (§1).
- Debounced (~300ms), requires 2+ characters before searching. Results interleave movies and shows in one list, each row tagged with its type, sorted however Radarr/Sonarr already rank them — no custom re-ranking. No matches after the debounce settles shows a plain "No matches for '<query>'" state, not an error.
- Filter by metadata: genre, release-date range, and other relevant facets — on the dedicated search page. Sort the results too (relevance, title, release date). The nav-bar field is a quick jump into the same search, not a second filtering or sorting surface.
- Selecting a result opens its detail page (§4 or §5), whether or not the title has been downloaded yet — the detail page itself already has to show both states (Download vs. Watch/Delete).

## 4. Show Detail Page
- Title, cast, and show-level metadata.
- Seasons, and the episodes within each season.
- Download a single episode, a full season, or the entire series.
- Delete (once downloaded) a single episode, a full season, or the entire series.
- **Watch** navigates to Emby once indexed; shows "Indexing…" otherwise (see Playback model).
- File selection/replacement and bad-file reporting per §6.

## 5. Movie Detail Page
- Same metadata surface as the show page — trailer, cover art, cast — but only one file to manage (no seasons/episodes).
- Download or delete the movie's single file.
- **Watch** navigates to Emby once indexed; shows "Indexing…" otherwise (see Playback model).
- File selection/replacement and bad-file reporting per §6.

## 6. File Selection, Replacement & Bad-File Reporting
Radarr and Sonarr both expose the list of available release files for a given movie or episode; the app surfaces this instead of locking users into one automatic choice.

- **Picking a file:** browse available releases for a movie/episode and choose which to download.
- **Replacing a bad download:** one flow — the user picks a new file, and the app deletes the old file and downloads the new one automatically. No manual delete step.
- **Reporting a bad file:** flagging a file as bad shows a "bad file" indicator in the UI and blocks that release from being auto-selected again if the item is deleted and re-downloaded — but **this block is enforced only inside the download app**. It doesn't touch Radarr/Sonarr's own selection logic, so a user going directly to Radarr's or Sonarr's UI can still grab the flagged release. Accepted as a known gap, by design.

## 7. Unified Gallery
- One gallery spanning all three media types.
- Filterable by date, uploader/author (where available), media type, and other relevant facets — mirroring §3's discovery filters.
- Each item links to its detail page; attribution avatars render per the Core Concepts model, and movie/show cards follow the same Emby/Indexing playback behavior.

## 8. Video Detail Page
- Cover art/thumbnail, title, author.
- Link back to the original source post.
- Action to download the video, distinct from the local-save action in §9.
- Reached from the nav-bar field's Download button (Entry-point model, Core Concepts) with the download already under way — or, if yt-dlp doesn't recognize the link after all, a "not recognized" state here instead, pointing the user back at the nav bar to try a different link.

## 9. Local Downloads ("Save to Your Device")
Normal downloads land on the lilnas server, not the user's machine. A separate, explicit action lets a user pull a video, movie, or show file down to their own device — for offline viewing or to bypass the server entirely.

## 10. Downloads Activity Page
Visible to everyone: all downloads currently in progress, across all users, in real time. For videos with attribution hidden, regular users see that entry anonymized — **admins see the real attributing user inline on this same page**, not through a separate view.

## 11. Admin Dashboard
Admin-only:
- System-wide insights/metrics on download activity.
- The Downloads Activity Page (§10) in its enriched form — true attribution always visible, including videos toggled anonymous for everyone else.
- Per-user download history.
- Aggregate stats (most active downloaders, usage trends, etc.).
- **Audit log:** full trail of user interactions with the download system, extensible to future services calling into the download API.
