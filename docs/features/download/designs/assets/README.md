# Mockup assets

Real poster art and video thumbnails for every mockup under `../*.html`,
fetched from the household's own Emby library and YouTube — used in place of
the CSS-gradient placeholder so the mockups can be checked against real
imagery (busy color, baked-in title typography, actual aspect ratios).

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

Each mockup references these files by relative path (`assets/emby/movie-4.jpg`,
etc.), and `../src/runtime.js` drops any `<img>` that fails to load: if a file
isn't there — a fresh clone, or `EMBY_API_KEY`/`yt-dlp` unavailable — the card
reverts to the gradient placeholder behind it automatically. Nothing breaks
either way.

## Which mockup uses which asset

`home.html` presents itself as real "recently added" library data, so its
labels are hardcoded to match whatever Emby actually returns as most-recently-
added at fetch time (`movie-1`/`movie-4`, `show-1`/`show-4`, `video-1`/`video-2`)
— see `fetch_posters`'s `DateCreated`/`Descending` sort in `fetch-assets.sh`.
That pairing is inherently a little fragile (the library's "recently added"
changes over time); it's a pre-existing tradeoff, not something the other
mockups repeat.

Every other mockup (`gallery.html`, `search.html`, `movie-detail.html`,
`show-detail.html`, `video-detail.html`, `admin-dashboard.html`,
`downloads-activity.html`) uses **fictional** titles ("Salt & Ceremony",
"Harbor Watch", "Sourdough starter, day one to seven", ...) that recur
identically across pages. Those are wired to a fixed title → asset mapping
(the same fictional item always gets the same real image everywhere it
shows up, e.g. "Salt & Ceremony" is always `emby/movie-1.jpg`), independent
of whatever Emby actually returns — semantic mismatch between the fictional
caption and the real art doesn't matter for the stated purpose (checking
color/typography/aspect ratio), only visual variety and consistency do.
`nav-search.html` and `index.html` have no poster elements and need nothing.
