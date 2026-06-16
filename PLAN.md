# Combined Repo Plan — "Return Them Home" on Cesium

Merging **`british-museum-repatriation-map`** (the storytelling globe) and
**`British-museum-model-globe`** (the photoreal building sandbox) into one
Cesium-based, Vite-built application.

Decisions locked in:
- **Engine:** standardize on CesiumJS.
- **Build:** adopt Vite (drop the no-build import-map setup).
- **Repo creation:** planning only for now — nothing new created or pushed.
- **Hardware baseline:** Apple Mac mini (M4) class. This 3D experience is
  meant to be cinematic; lower-functioning hardware falls back to the
  existing 2D map (the reason for moving to Cesium in the first place).
- **Payload:** the 15MB model + atlas payload is acceptable for GitHub Pages.
  No low-res proxy models / no low-poly fallbacks.
- **Pull-back:** keep the photoreal building visible during the global
  pull-back (do not fade it to a stylized marker).

---

## What each source repo contributes

### `british-museum-repatriation-map` (story globe)
- No-build static three.js app (three + topojson via jsDelivr import map).
- 5,000 real British Museum object photos piled on the museum in Bloomsbury
  (`BM = {lat: 51.5194, lng: -0.1269}`), streaming home along great-circle
  arcs to 88 nations — animated entirely in a GPU vertex shader.
- Photo-disc atlas: 5 x 2048px sheets, plus detail/thumb image sets.
- Data-driven: `data/artifacts.json` (5MB, 5,000 objects),
  `countries-110m.json`, `atlas_manifest.json`.
- Loads a low-poly `assets/british-museum.glb` to seat the pile.
- Mature (v1.0). Playwright/Python enrichment tooling, auto cache-busting.
- **Contributes:** data, narrative logic, animation design.

### `British-museum-model-globe` / `cesium-globe-test` (photoreal building)
- Vite + CesiumJS, build step, gh-pages deploy.
- High-quality 15MB British Museum model (`public/1-2.glb`) on a real-world
  satellite-imagery + world-terrain globe at `51.51965, -0.12718`, with a
  tuned hero view. Calibrated transform: heightOffset -10, heading 55,
  scale 85.9.
- Calibration UI (scale/heading/height/lat/lon sliders), D-pad camera,
  FPS/draw-call perf monitor.
- **Contributes:** the engine, the photoreal model, accurate geo-placement.
- Caveats: real app lives entirely in `index.html`; `src/main.js` is still
  the default Vite template (dead cruft); Cesium Ion token is hardcoded;
  one large binary makes the repo ~99MB.

---

## Target product
One Cesium app on a photoreal Earth. Open on the real 3D British Museum at
Bloomsbury, then pull back and watch 5,000 object photo-discs stream home
along arcs to 88 nations, plus the "watch how they were taken" year-by-year
replay. Repo 1's stylized three.js globe is retired; its data, narrative
logic, and animation design are ported onto Cesium.

## Stack
- Vite 8 + the `cesium` npm package. Drop the committed 75MB `public/cesium/`
  build; serve Cesium via `vite-plugin-cesium`. Cuts the repo from ~99MB to
  ~20MB.
- Plain JS (matches both codebases; avoids a TS porting tax).
- `vite build` -> GitHub Pages (`gh-pages`), `base` set to the new repo name.

## Proposed layout
```
/
├─ index.html                      # thin entry; mounts #cesiumContainer + UI
├─ vite.config.js                  # base, vite-plugin-cesium, asset size limits
├─ package.json
├─ src/
│  ├─ main.js                      # viewer bootstrap, scene config, lighting/atmosphere
│  ├─ museum.js                    # geo-place the model (calibrated transform)
│  ├─ artifacts/
│  │  ├─ primitive.js              # custom Cesium Primitive: 5k instanced photo-discs
│  │  ├─ shader.glsl.js            # vertex slerp pile<->origin + atlas UV (ported from app.js)
│  │  └─ data.js                   # load artifacts.json, parse acq years, build attributes
│  ├─ story.js                     # timeline: intro -> "return them home" -> "how taken"
│  ├─ ui/                          # detail card, narration, controls (port app.css styling)
│  └─ calibration.js               # repo 2's slider/D-pad/perf UI, behind ?dev=1 flag
├─ public/
│  ├─ models/british-museum.glb    # the 15MB high-quality model (repo 2's 1-2.glb)
│  └─ data/                        # artifacts.json, atlas_manifest.json (+ atlas/detail/thumb)
└─ tools/                          # ported enrichment scripts (cache-bust tooling dropped — Vite hashes)
```

## The hard part: porting the repatriation animation to Cesium
Repo 1 animates entirely in a three.js vertex shader (slerp each disc between
a Bloomsbury pile slot and its origin on a unit sphere). The faithful Cesium
equivalent:
- Custom `Cesium.Primitive` + `Appearance` with custom GLSL, one instanced
  quad per object (not `BillboardCollection`, which can't do GPU slerp and
  would need 5k CPU updates/frame).
- Per-instance attributes: origin lon/lat, pile-slot offset, atlas tile UV,
  per-object stagger — the same data repo 1 already computes.
- Coordinates move from three.js unit-sphere to Cesium ECEF: slerp the two
  surface unit vectors, scale by `R + arcHeight*sin(pi*t)` for the
  great-circle lift. Drive with one `u_t` uniform; reuse repo 1's
  easing/stagger.
- Precision: set the primitive `modelMatrix` to an Earth-centered frame and
  keep RTC offsets in floats — fine at disc scale and pull-back distance;
  close-up framing is handled by the photoreal model, not the discs.
- Reuse the 5 x 2048px atlas sheets unchanged as bound textures. These are a
  separate render pass from the Cesium imagery/terrain/model, so they cannot
  degrade the photoreal views — they only affect the discs themselves. At
  ~64px per tile the discs are crisp at the pile/arc/mid-far framing they are
  actually seen at; full-res images already live in the detail card. On the
  M4 baseline with no payload limit, we can optionally regenerate the atlas at
  higher resolution (e.g. 4096px sheets -> ~128px tiles) for sharper discs.
  "Reuse unchanged" is the default; "regenerate sharper" is a free upgrade.
- No GPU fallback path for the discs — the M4 baseline carries the custom
  Primitive; lower hardware uses the separate 2D map instead.

## Fixes to make while merging (found in repo 2)
1. Hardcoded Cesium Ion token in `index.html` -> move to a Vite env var
   (`VITE_CESIUM_ION_TOKEN`), use a domain-restricted token, document
   offline-imagery fallback. The committed token should be treated as
   compromised and rotated.
2. Delete dead Vite template (`src/main.js`, `counter.js`, hero/vite/js svgs).
3. Stop committing the Cesium dist (~75MB); consider git-LFS for the model.
4. Drop repo 1's low-poly `assets/british-museum.glb` (superseded by the
   15MB model).

## Phases
1. **Scaffold** — Vite + cesium + vite-plugin-cesium; viewer boots; museum
   model geo-placed with repo 2's calibrated transform + hero view.
2. **Data in** — load `artifacts.json`, render the 5,000 discs statically at
   their origins (atlas textures working).
3. **Animation** — port the slerp shader; pile->home transition driven by
   `u_t`; arc lift + stagger.
4. **Narrative** — "Return them home" / "Watch how they were taken" timeline,
   detail card, narration UI ported from repo 1.
5. **Polish** — calibration UI behind `?dev=1`, token/env hardening, deploy
   config, README.

## Resolved
- Photoreal building stays visible through the global pull-back.
- 15MB model + atlas payload accepted for GitHub Pages; no low-res proxies.
- Atlas reused unchanged by default; optional higher-res regen available on
  the M4 baseline. Discs never degrade the photoreal views (separate pass).
- M4 hardware baseline; lower hardware falls back to the 2D map.
