# Mockup assets

Real poster art and video thumbnails for `../home.html`, fetched from the
household's own Emby library and YouTube — used in place of the CSS-gradient
placeholder so the mockup can be checked against real imagery (busy color,
baked-in title typography, actual aspect ratios).

**Nothing under `emby/` or `video/` is committed.** This repo is public, and
Emby's posters are studio-owned key art (Emby's own library turned up things
like the official *Scary Movie* and *The Mandalorian and Grogu* artwork) —
not something to publish here. Both directories are gitignored; regenerate
them locally instead:

```bash
cp .env.example .env   # fill in EMBY_API_KEY
./fetch-assets.sh
```

`EMBY_API_KEY` lives in 1Password as **"Emby - TDR API Key"**. `fetch-assets.sh`
needs `curl`, `jq`, and (for the video thumbnails) `yt-dlp` on `PATH`.

`home.html` references these files by relative path (`assets/emby/movie-4.jpg`,
etc.) with an `onerror` fallback: if a file isn't there — a fresh clone, or
`EMBY_API_KEY`/`yt-dlp` unavailable — the card reverts to the original CSS
placeholder automatically. Nothing breaks either way.
