# Return Them Home — British Museum Repatriation Map

A cinematic 3D globe. 5,000 real British Museum object photographs sit piled
on one building in Bloomsbury; press **Return them home** and watch them
stream along glowing great-circle arcs back to their origins across 88
nations. A second pass, **Watch how they were taken**, replays the
acquisitions in order, year by year, from 1600 to 2025.

## How it works

- `index.html` / `app.css` / `app.js` — the whole app. No build step:
  three.js and topojson-client load from jsDelivr via an import map.
- All 5,000 points are textured photo-discs drawn from five 2048 px atlas
  sheets (`assets/bm/atlas/`) and animated entirely on the GPU — the vertex
  shader slerps each object between its museum pile slot and its true
  origin, staggered per object, with additive comet-trail echo passes.
- Acquisition years are parsed from British Museum registration numbers
  (e.g. `1888,0601.716` → 1888).
- Data: `data/artifacts.json` (5,000 objects with coordinates, dates,
  materials and image licensing), `data/countries-110m.json` (borders),
  `data/atlas_manifest.json` (atlas tile UVs).
- `legacy.html` — the original 2D map, linked from the deck.

## Never serve a stale version again

Browsers and the GitHub Pages CDN aggressively cache `app.js`/`app.css`,
which made earlier edits appear "not deployed". These helpers remove the
guesswork (all live in `tools/`, run from anywhere in the repo):

| Command | What it does |
| --- | --- |
| `./tools/fresh.sh` | Kills any running server, pulls the latest commit, and serves it on a **brand-new port** the browser has never cached. Use this to preview locally. |
| `./tools/serve.sh` | Just serve on a fresh random port (no pull). |
| `./tools/bust-cache.sh` | Rewrites the `?v=` token on the assets to a hash of their contents. Runs automatically on every commit. |
| `./tools/check-live.sh` | Fetches the live site bypassing caches and confirms it matches your local build. Run after pushing. |

**Cache-busting is automatic.** A pre-commit hook (in `tools/githooks`)
re-hashes the assets so each change ships under a new URL — a stale file
can no longer be served. After cloning, enable it once with:

```bash
git config core.hooksPath tools/githooks
```

The on-screen build stamp (bottom-left) and the gold `[Return Them Home]
build …` console line always tell you which version is actually running.

## Licence

Object photographs © The Trustees of the British Museum, CC BY-NC-SA 4.0
unless noted otherwise in each object's panel.
