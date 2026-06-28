# Return Them Home — 2D Map (edge / mobile)

The lightweight **2D** companion to the full 3D *Return Them Home* experience,
for **phones, tablets and low-power devices**. An interactive Leaflet map of
all **5,000** British Museum objects at their origins, with **marker
clustering** for smooth performance and a photo + full detail card on tap.

No WebGL, no Cesium, no 3D tiles, no build step. A separate, standalone
project from the 3D app by design.

## Stack
- **Leaflet** + **Leaflet.markercluster** (from CDN).
- `artifacts.json` — all 5,000 objects (bundled).
- `atlas/atlas_0..4.jpg` — 4096px atlas sheets; each object's thumbnail is a
  CSS-cropped tile, so there are no per-object image downloads.

## Run locally
```bash
python3 -m http.server 8000   # open http://localhost:8000/
```

## Deploy (GitHub Pages)
Push, then **Settings → Pages → Source: Deploy from a branch → `main` /
`/ (root)`**. No build needed.

The "3D Globe" link points at the full 3D app (`../return-them-home/`).

## Licence
Object photographs © The Trustees of the British Museum, CC BY-NC-SA 4.0.
