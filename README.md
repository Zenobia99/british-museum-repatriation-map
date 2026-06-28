# Return Them Home — Lite

A lightweight **2D** version of the *Return Them Home* British Museum
repatriation map, built for **phones, tablets, and low-power devices**.

No WebGL, no Cesium, no 3D tiles — just an HTML5 Canvas equirectangular world
map. The 5,000 real British Museum objects are plotted at their origins; press
**Return them home** to watch them stream out from Bloomsbury along arcs, or
**Timeline Back** to bring them home in acquisition-year order with a year
ticker. Tap any object for its detail card.

This is a **separate, standalone project** from the full 3D experience
(`return-them-home`) — deliberately decoupled so it can't affect it.

## Stack

- Plain HTML + CSS + a single ES-module `lite.js`. **No build step.**
- Canvas 2D for the map and animation.
- `topojson-client` loaded from a CDN (for the country borders).
- Data: `data/artifacts.json` and `data/countries-110m.json` (bundled).
- Object photos in the detail card load from the British Museum media CDN.

## Run locally

It's static — serve the folder with anything:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

## Deploy (GitHub Pages)

No build needed. Push to your repo, then **Settings → Pages → Build and
deployment → Source: Deploy from a branch → `main` / `/ (root)`**. Done.

## Licence

Object photographs © The Trustees of the British Museum, CC BY-NC-SA 4.0
unless noted otherwise.
