# Return Them Home

A cinematic CesiumJS experience. It opens front-on at the **real British
Museum** in Bloomsbury — rendered from Google's photorealistic 3D tiles — with
**5,000 real object photographs** heaped in the Great Court. Press **Return
them home** and watch them stream along glowing great-circle arcs back to their
origins across 88 nations; press **Timeline Back** to pull them home again in
acquisition order, year by year (1600 → 2025), with a counting year ticker.
Click a country label or an individual disc to open its museum detail card.

This is the combined successor to two earlier projects:

- `british-museum-repatriation-map` — the storytelling globe (data + the
  repatriation animation, originally a no-build three.js app).
- `British-museum-model-globe` — the photoreal building sandbox (CesiumJS).

## Stack

- **CesiumJS** for the globe, plus **Google Photorealistic 3D Tiles** for the
  street-level view of London and the museum.
- The 5,000 artefacts are GPU-animated photo-discs drawn from five 4096px atlas
  sheets, flown between the museum pile and their origins entirely in a custom
  vertex shader (great-circle arcs, staggered per object).
- Country borders + clickable per-origin labels from Natural Earth 110m data.
- **Vite** for the dev server and build (`vite-plugin-cesium` serves Cesium's
  static assets — they are never committed). Deploys to **GitHub Pages**.

## Getting started

Requires Node.js 18+.

```bash
npm install
cp .env.example .env.local   # add your Cesium Ion token (free)
npm run dev                  # http://localhost:5180/return-them-home/
```

Open the printed URL **including the `/return-them-home/` path**.

### Credentials

- **Cesium Ion token** (`VITE_CESIUM_ION_TOKEN`) — required for terrain and the
  3D tiles. Free at https://ion.cesium.com/tokens. Without it the app falls
  back to token-free OpenStreetMap imagery.
- **Google Photorealistic 3D Tiles** — either set a Google Maps Platform key
  in `VITE_GOOGLE_MAPS_API_KEY`, or add the "Google Photorealistic 3D Tiles"
  asset (id `2275207`) to your Cesium ion account (loads with the ion token).
  Without either, the app keeps the satellite-imagery globe.

```bash
npm run build     # production build -> dist/
npm run preview   # preview the production build
npm run deploy    # build + publish dist/ to GitHub Pages
```

## Using it

- **Return them home** — artefacts fly from the museum to their origin nations.
- **Timeline Back** — they return in acquisition-year order, with a year
  ticker; settles back on the museum. The gold button then becomes **Reset**.
- **Country labels / discs** — click to open the detail card (photo, origin,
  date, material, museum number, description, link to the British Museum).
- **Camera** — drag to orbit, scroll to zoom, or use the on-screen
  zoom/rotate/tilt cluster (bottom-right). `?dev=1` adds a pile-tuning panel.

## Hardware baseline

This 3D experience targets Apple Mac mini (M4) class hardware and up — it is
meant to be cinematic. No low-poly proxy models.

## Licence

Object photographs © The Trustees of the British Museum, CC BY-NC-SA 4.0
unless noted otherwise.
