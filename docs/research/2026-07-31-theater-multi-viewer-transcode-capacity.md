---
title: Theater Multi-Viewer Streaming — Transcode Capacity Research
date: 2026-07-31
status: reference
type: research
related:
  - apps/theater/src/emby/emby.service.ts
  - apps/theater/src/playback/store.ts
  - apps/theater/src/playback/sync.ts
  - infra/media.yml
tags:
  - theater
  - emby
  - transcoding
  - ffmpeg
  - hdr
  - capacity-planning
---

# Theater Multi-Viewer Streaming — Transcode Capacity Research

## Purpose

`@lilnas/theater` opens one Emby playback session **per client**. The question was whether
that scales to 5–7 simultaneous viewers, and whether a Discord-style "one person streams,
everyone else watches the relay" model would be more efficient.

This document records the **measured** answer so it doesn't have to be re-derived. Every
number below was benchmarked on the actual lilnas hardware against actual library files on
2026-07-31 — none of it is estimated unless explicitly labelled as such.

**This is not an implementation plan.** It carries no implementation units or test scenarios.

---

## TL;DR

1. **Don't build a relay or SFU.** Bandwidth is not the constraint — 7 clients at 8 Mbps is
   ~3% of available upstream. A self-hosted relay would move zero bytes off the same NIC.
2. **The constraint is 4K HDR transcode CPU, and it is severe.** A single
   4K HEVC HDR → 1080p H.264 stream consumes ~94% of a 32-thread 7950X with the naive
   filter order. Three concurrent streams run at ~1.0× realtime each. Seven is impossible.
3. **This applies _only_ to 4K HDR sources.** A 1080p H.264 8-bit source needs a _remux_
   (video stream copied verbatim), which measured at 48–88×. Seven concurrent remuxes are a
   rounding error.
4. **Hardware acceleration is a dead end on this box.** `tonemap_vaapi` fails on AMD, and
   plain VAAPI transcoding is _slower_ than software. Emby Premiere would not help.
5. **Therefore: pre-convert 4K titles before group watches. Leave 1080p H.264 titles alone.**

---

## Environment (as measured)

| Component        | Value                                                         |
| ---------------- | ------------------------------------------------------------- |
| CPU              | AMD Ryzen 9 7950X, 16 cores / 32 threads                      |
| RAM              | 96 GB                                                         |
| iGPU             | Present and exposed — `/dev/dri/card0`, `/dev/dri/renderD128` |
| OS               | Arch Linux, kernel 7.0.3-arch1-2                              |
| ffmpeg           | n8.1.1                                                        |
| Network          | 2187 Mbps down / **1685 Mbps up**                             |
| Media storage    | `/mnt/hdd1`, btrfs on spinning disk, 19 TB (5.1 TB free)      |
| Root/app storage | NVMe, 3.7 TB                                                  |

Vulkan note: `vulkan-icd-loader` is installed but **no ICD driver is present**
(`/usr/share/vulkan/icd.d/` does not exist, `vulkan-radeon` not installed), so
`libplacebo` could not be tested.

---

## Current architecture

Each client independently resolves its own playback session. From
`apps/theater/src/playback/sync.ts`:

```
// A genuinely new item. Each client resolves its own quality/subtitles/
// session — per-client transcode sessions are correct and already how
// load() works.
```

Flow per client: `load()` → `GET /api/theater/playback/:id` → backend POSTs
`/Items/{id}/PlaybackInfo` → Emby returns a distinct `PlaySessionId` and `TranscodingUrl`.

Quality tier is client-local and never synced (`playback/store.ts`), so two clients on
different tiers produce genuinely different transcodes with no possibility of dedup.

All video bytes are proxied through the NestJS backend (`proxyHls` / `streamDirect` in
`emby/emby.controller.ts`), so the backend is in the byte path for every client.

---

## Costs analyzed, and which ones matter

| Cost                  | Scales with | Verdict                                                                               |
| --------------------- | ----------- | ------------------------------------------------------------------------------------- |
| Upstream bandwidth    | N           | **Non-issue.** 7 × 8 Mbps = 56 Mbps of 1685 available (3.3%). Even 7 × 20 Mbps is 8%. |
| Transcode CPU         | N           | **The binding constraint**, for 4K HDR sources only. See benchmarks.                  |
| Proxy overhead (Node) | N           | Non-issue. 56 Mbps ≈ 7 MB/s piped.                                                    |
| Disk read             | N           | Non-issue. Synced viewers read the same offsets; 96 GB page cache absorbs it.         |

### Why a relay/SFU was rejected

Discord's model appears cheap because **Discord's SFU pays the fan-out bandwidth** — the
host uploads one stream to Discord's datacenter and Discord fans out to N. Self-hosting that
gets none of the benefit:

- **SFU on lilnas** — bytes leave the same NIC as today. Zero bandwidth savings; saves only
  transcode CPU, which pre-conversion solves better.
- **WebRTC mesh with a player as host** — a residential uplink would carry N−1 encoded
  streams, the host's CPU real-time-encodes, the host becomes a single point of failure, and
  quality drops to screen-share quality. Strictly worse.

There is also no "play it on the server and stream from there" step to add: the server
already _is_ the single source. What was missing was **sharing**, not centralization.

---

## Benchmarks: 4K HDR → 1080p

Test file: `The.Accountant.2016.PROPER.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.7.1-FGT.mkv`
(HEVC, 3840×2160, `yuv420p10le`, `smpte2084` HDR10, 60 Mbps).
60-second samples, `-preset veryfast`, full 32 threads unless noted.

| #   | Pipeline                                         | Speed vs realtime                |
| --- | ------------------------------------------------ | -------------------------------- |
| 1   | Tonemap @4K → scale → x264                       | **1.06×**                        |
| 2   | Scale → x264, **no tonemap**                     | 3.38×                            |
| 3   | HEVC 4K **decode only**                          | 3.88×                            |
| 4   | VAAPI hw decode + `tonemap_vaapi` + `h264_vaapi` | ❌ fails, `-22 Invalid argument` |
| 5   | VAAPI hw decode + `h264_vaapi`, no tonemap       | 2.11×                            |
| 6   | **Scale → tonemap @1080p → x264**                | **2.4×**                         |
| 7   | `libplacebo` (Vulkan tonemap)                    | ❌ untestable — no Vulkan ICD    |
| 8   | 3× concurrent of #6                              | ~1.0× each → **3.0× aggregate**  |

### Cost decomposition (fraction of the whole box, per stream)

Derived from the reciprocals of the above:

| Stage                  | Share of box                                 |
| ---------------------- | -------------------------------------------- |
| HEVC 4K decode         | ~26%                                         |
| + scale + x264 encode  | ~30% (so x264 `veryfast` itself is only ~4%) |
| + tonemap **at 1080p** | ~42%                                         |
| + tonemap **at 4K**    | ~94%                                         |

**Tonemapping dominates, and its cost is proportional to pixel count.** The `zscale`/`tonemap`
chain converts to `gbrpf32le` — 32-bit float per channel, ~99 MB per frame at 4K vs ~25 MB at
1080p. Scaling _before_ tonemapping is worth **2.3×** for identical output.

### Key findings

- **The ceiling is decode, not encode.** HEVC 4K decode alone caps software at 3.88×. No
  encoder tuning gets past it, and VAAPI decode is _slower_. ~3 concurrent 4K streams is the
  hardware limit regardless of downstream choices.
- **3 concurrent streams already run at realtime with zero margin.** Any competing load and
  every viewer stalls.
- Benchmarks used `-preset veryfast`. Since x264 is only ~4% of cost at that preset, `medium`
  is comparatively cheap and `slow` roughly doubles batch time _(estimated, not measured)_.

---

## Benchmarks: 1080p sources

Test file: `Click.2006.1080p.BluRay.REMUX.MPEG-2.TrueHD.5.1-EPSiLON` (`mpeg2video`,
1920×1080, `yuv420p`), 120-second samples.

| #   | Pipeline                                               | Speed     |
| --- | ------------------------------------------------------ | --------- |
| 9   | `-c:v copy` + audio → AAC (pure remux)                 | **48.6×** |
| 10  | Re-encode @ 6 Mbps, `-preset medium`, no scale/tonemap | **5.09×** |

Full-file validation on `Backrooms.2026.1080p.TELESYNC.x264-DKS.mkv` (h264, 1920×890,
`yuv420p`, `bt709`, 7.8 Mbps, 6.35 GB): complete remux to MP4/AAC in **108 seconds
(60.2× overall)**, output duration matching source exactly.

⚠️ `-c:v copy` is only valid when the source video codec is already browser-playable
(H.264 8-bit). The MPEG-2 file above copies at 48.6× but the result would be an
unplayable MPEG-2 MP4 — those titles need the 5.09× re-encode path.

---

## Library composition (as measured)

- **270 movie directories, 80 TV directories**
- **4703 `.mkv` + 127 `.mp4`** video files
- Filename resolution sweep: **207 × 2160p**, 61 × 1080p, 10 × 4k, 1 × 720p
  → **roughly 80% of movies are 4K**

12-title random `ffprobe` sample:

| Property  | Finding                                                                 |
| --------- | ----------------------------------------------------------------------- |
| Video     | 10/12 HEVC 4K; every 4K file is `yuv420p10le` (10-bit)                  |
| HDR       | 10/12 `smpte2084` (HDR10); several Dolby Vision in filenames            |
| Bitrate   | 6–87 Mbps; BD remuxes 47–87 Mbps (Saving Private Ryan: 94 GB / 74 Mbps) |
| Audio     | `truehd`, `dts`, `dts-hd`, `ac3`, `eac3` — only **1 of 12** had AAC     |
| Subtitles | `hdmv_pgs_subtitle` on 9/12; `subrip` on 5/12                           |

### Two non-obvious consequences

1. **Audio alone disqualifies direct play on nearly every title.** TrueHD/DTS are not
   browser-playable, so essentially nothing in the library direct-plays today — including
   files that are already 1080p H.264.
2. **PGS subtitles force a full video re-encode** when selected
   (`TranscodeReasons=SubtitleCodecNotSupported`), because Emby burns image subs into the
   video. Sidecar `.srt` avoids this entirely; muxing PGS into an output does not.

---

## The operational rule

Classify by **source video codec and colour properties**, not by resolution alone:

| Source                    | Emby's per-client work               | Group of 7                   |
| ------------------------- | ------------------------------------ | ---------------------------- |
| 1080p **H.264 8-bit SDR** | Remux only (video copied)            | ✅ Works as-is, no prep      |
| 1080p MPEG-2 / VC-1       | Re-encode @ ~5×                      | ⚠️ Marginal — pre-convert    |
| **4K HEVC HDR**           | Scale + tonemap + encode @ 1.06–2.4× | ❌ Broken — must pre-convert |

Check any title with:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,pix_fmt,color_transfer \
  -of csv=p=0 "<file>"
```

- `h264,1920,yuv420p,bt709` → watch as-is
- `hevc,3840,yuv420p10le,smpte2084` → convert first (~50–75 min per 2h title)

### Conversion recipes

**1080p H.264 8-bit → direct-playable MP4** (seconds to ~2 min per title):

```bash
ffmpeg -i "in.mkv" -map 0:v:0 -map 0:a:0 \
  -c:v copy -c:a aac -b:a 192k -ac 2 -movflags +faststart "out.mp4"
```

**4K HEVC HDR → 1080p H.264 SDR** — note scale **before** tonemap:

```bash
ffmpeg -i "in.mkv" -map 0:v:0 -map 0:a:0 \
  -vf "scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2,\
zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,\
tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p" \
  -c:v libx264 -preset medium -crf 21 -maxrate 6M -bufsize 12M -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ac 2 -movflags +faststart "out.mp4"
```

Required flags and why:

- `-movflags +faststart` — moves the `moov` atom to the front. Without it the Range-forwarding
  proxy at `/theater/stream/:id` cannot seek without pulling the whole file.
- `-pix_fmt yuv420p` — 4K sources are 10-bit; H.264 High 10 is not browser-playable.
- `-maxrate 6M` — deliberately under the `'1080p'` tier's `8_000_000` cap in
  `playback/store.ts`. Peaks brushing the cap can make Emby transcode anyway.
- `-ac 2` — TrueHD/DTS aren't browser-playable and multichannel AAC in MP4 is unevenly
  supported. Surround is lost; the player is spatial-audio-in-3D anyway.

### Emby multi-version layout

```
Movies/The Matrix (1999)/
    The Matrix (1999) - 4K.mkv
    The Matrix (1999) - 1080p.mp4
    The Matrix (1999) - 1080p.en.srt
```

Emby treats multiple video files in one movie folder as alternate versions, labelling by the
text after the last `-`. Verify grouping in the Emby web UI — one entry with a version
dropdown, not two movies. _(Convention applied from Emby docs; not yet validated live.)_

### Batch estimate, if converting the whole 4K library

~217 4K titles × ~2h ≈ 434 movie-hours ÷ 3.0× aggregate ≈ **~6 days** continuous at
`veryfast` running 3 at a time; ~1.5 TB output against 5.1 TB free on `/mnt/hdd1`.
Recommended instead: convert on demand ahead of each movie night, optionally with a
`nice 19` background batch filling in the rest over weeks.

---

## Approaches ruled out

| Approach                             | Why not                                                                                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relay / SFU / host re-stream         | Zero bandwidth savings on self-hosted infra; CPU savings available more cheaply. See above.                                                                                                                                                                    |
| **Emby Premiere for hw transcoding** | `tonemap_vaapi` fails (`-22`) on Mesa radeonsi — it's effectively an Intel iHD feature. Plain VAAPI measured _slower_ than software (2.11× vs 3.38×). **Would not solve the problem; do not buy for this.**                                                    |
| Shared one-transcode-per-room        | Genuinely fits the synced design (room-wide seeks already collapse to one), and would cut 7 decodes + 7 encodes to 1 + 1. But at 1.06–2.4× a single shared 4K transcode still leaves ~no headroom, so it is not safe on its own. Pre-conversion supersedes it. |
| `libplacebo` Vulkan tonemap          | Untested — requires installing `vulkan-radeon`. Plausible but unproven on a 2-CU RDNA2 iGPU.                                                                                                                                                                   |

---

## Open issues found along the way

Not addressed; recorded so they aren't rediscovered.

### 1. Sync loop hard-seeks a buffering client (real bug)

`playback/store.ts` `tick()`:

```ts
const HARD_SEEK_DRIFT_SECONDS = 0.75
const drift = video.currentTime - target
if (Math.abs(drift) > HARD_SEEK_DRIFT_SECONDS) {
  video.currentTime = target
```

The anchor advances on **wall-clock**. A client stalling to buffer sees `currentTime` freeze
while `target` keeps moving, so after 0.75s of stall it is hard-seeked forward — which on HLS
flushes the hls.js buffer and re-fetches, discarding exactly the data a bandwidth-starved
client just paid for. `tick()` runs every frame from `useFrame`, so this repeats indefinitely.

The logic treats drift as a _clock_ problem; for a starved client it's a _throughput_ problem.
Suggested fix: when `video.readyState < HAVE_FUTURE_DATA` (or a recent `waiting` fired), let
the client lag instead of seeking, and/or downshift its quality tier.

### 2. The `auto` quality tier is probably not adaptive

`QUALITY_MAX_BITRATE.auto` is `null` — no cap, not ABR. A live Emby HLS transcode typically
emits a master playlist with a **single** `#EXT-X-STREAM-INF`, leaving hls.js nothing to
switch between. **Unverified** — inspect an actual `master.m3u8` to confirm. If true, "auto"
means "uncapped," and slow clients have no automatic adaptation path.

`setQuality` → `reresolveAndResume` already handles resume-in-place correctly, so driving it
from stall counts or `hls.bandwidthEstimate` would be a small change.

### 3. All clients share one Emby `DeviceId`

`emby.service.ts`: `DEVICE_ID = 'lilnas-theater-backend'`, constant for every client. Emby keys
sessions by device; 5–7 concurrent play sessions claiming one device ID may confuse its session
tracking or transcode reaping. `stopTranscode` deletes by `PlaySessionId` + that shared ID so
cleanup is likely fine. **Unverified** — confirm distinct live sessions in the Emby dashboard
with 3+ clients playing.

---

## Code change made

`emby/emby.service.ts` previously selected `data.MediaSources?.[0]` — safe only while every
title has exactly one version. Once a title has both a 4K original and a 1080p MP4, Emby
returns one `MediaSource` per version and the array order is not contractual, so `[0]` can
silently yield the 4K one.

Changed to prefer whichever version this `DEVICE_PROFILE` can actually direct-play, falling
back to the first source otherwise. The capability expression already existed inline for the
`canDirectStream` mode decision; it was extracted to `hasDirectPlayCapability(source)` and
reused for both selection and mode, so one definition serves both.

No behaviour change for single-version items (`.find()` either matches the one source or falls
back to it). Type-checks clean.

---

## Reproducing the measurements

```bash
# Library composition
find /storage/media-library/movies -type f -iname "*.mkv" -o -iname "*.mp4" \
  | grep -oiE "2160p|1080p|720p|4k" | tr "[:upper:]" "[:lower:]" | sort | uniq -c | sort -rn

# Per-title properties
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,color_transfer -of default=nw=1 "$F"

# Capacity: read `speed=` — a single stream at Nx realtime is a conservative
# floor for N concurrent realtime streams
ffmpeg -nostdin -y -ss 1800 -t 60 -i "$F" -map 0:v:0 -map 0:a:0 \
  -vf "<chain under test>" -c:v libx264 -preset veryfast -crf 23 \
  -c:a aac -b:a 192k -ac 2 -f null - 2>&1 | tr '\r' '\n' | grep "speed=" | tail -1
```

All benchmarks used `-f null -` and wrote no output files.
