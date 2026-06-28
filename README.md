# Return Them Home — 2D (edge / mobile)

The lightweight **2D** companion to the full 3D *Return Them Home* experience,
for **phones, tablets and low-power devices**. An interactive Leaflet map of
British Museum objects with photos and per-object detail — no WebGL, no Cesium.

Standalone, static, no build step. Separate from the 3D project by design.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

## Deploy (GitHub Pages)
Push to your repo, then **Settings → Pages → Source: Deploy from a branch →
`main` / `/ (root)`**. No build needed.

## Files
- `index.html` — the map app (Leaflet from CDN).
- `bm_final_artifacts.json` — the curated artefact list (204 objects).
- `images/` — object photographs.

The "Switch to 3D Globe Map" link points at the full 3D app
(`../return-them-home/`).

## Licence
Object photographs © The Trustees of the British Museum, CC BY-NC-SA 4.0.
