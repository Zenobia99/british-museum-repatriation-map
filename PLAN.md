# Combined Repo Plan — "Return Them Home" on Cesium

Merging **`british-museum-repatriation-map`** (the storytelling globe) and
**`British-museum-model-globe`** (the photoreal building sandbox) into one
Cesium-based, Vite-built application.

Decisions locked in:
- **Engine:** standardize on CesiumJS.
- **Build:** adopt Vite (drop the no-build import-map setup).
- **Repo creation:** planning only for now — nothing new created or pushed.

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
- Reuse the 5 x 2048px atlas sheets unchanged as bound textures.
- Fallback if perf disappoints on low-end GPUs: `BillboardCollection` along
  precomputed geodesic samples.

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

## Open questions for build time (not blocking)
- Keep the photoreal building visible during the global pull-back, or fade to
  a stylized marker once zoomed out?
- Is the 15MB model + atlas payload acceptable for GitHub Pages, or do we want
  a low-res proxy that swaps in on zoom?
