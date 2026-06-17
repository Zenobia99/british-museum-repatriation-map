import * as Cesium from 'cesium';
import { ATLAS } from './artifacts/data.js';

// Phase 4 — exploration. A clickable label per origin country (rendered as an
// HTML overlay so it always sits above the discs and is trivially clickable).
// Click a label to open a panel of that country's artefacts as atlas
// thumbnails; click a thumbnail to open the detail card.

// Normalise/clean origin_country values into display names, merging variants
// (e.g. "Egypt (Coptic)" -> "Egypt") so they share one label/panel.
const DISPLAY = {
  'Republic of Benin': 'Benin',
  'Democratic Republic of the Congo': 'DR Congo',
  'Cyprus (Greek)': 'Cyprus',
  'Egypt (Coptic)': 'Egypt',
  'Myanmar (Pagan)': 'Myanmar',
  'United States': 'United States',
};

const TILES_PER_ROW = ATLAS.atlasSize / ATLAS.tileSize; // 32
const THUMB = 76; // thumbnail box size, px
// Hide all labels when zoomed further out than this (camera height, metres).
const LABEL_MAX_HEIGHT = 2.3e7;

function displayName(originCountry) {
  return DISPLAY[originCountry] || originCountry || 'Unknown';
}

function styleThumb(el, art) {
  const { atlas_index: idx, u, v } = art.atlas;
  const sheet = TILES_PER_ROW * THUMB;
  el.style.backgroundImage = `url(${ATLAS.sheetUrl(idx)})`;
  el.style.backgroundSize = `${sheet}px ${sheet}px`;
  el.style.backgroundPosition = `-${u * sheet}px -${v * sheet}px`;
}

export function initExplore(viewer, artifacts, discList, discs) {
  const scene = viewer.scene;

  // Group artefacts by display country.
  const groups = new Map();
  for (const a of artifacts) {
    const name = displayName(a.origin_country);
    let g = groups.get(name);
    if (!g) {
      g = { name, items: [], sumLng: 0, sumLat: 0 };
      groups.set(name, g);
    }
    g.items.push(a);
    g.sumLng += a.lng;
    g.sumLat += a.lat;
  }

  const { panel, grid, panelTitle, panelCount } = buildPanel();
  const card = buildCard();

  function openCountry(g) {
    panelTitle.textContent = g.name;
    panelCount.textContent = `${g.items.length} object${g.items.length === 1 ? '' : 's'}`;
    grid.innerHTML = '';
    for (const a of g.items) {
      const t = document.createElement('button');
      t.className = 'thumb';
      t.title = a.name || a.bm_id;
      styleThumb(t, a);
      t.addEventListener('click', () => openDetail(a));
      grid.appendChild(t);
    }
    panel.classList.add('open');
  }

  function openDetail(a) {
    fillCard(card, a);
    card.root.classList.add('open');
  }

  // ---- HTML overlay labels, positioned each frame -----------------------
  // The labels are pointer-events:none so the globe always drags underneath
  // them (capturing the pointer would feel broken). Click + hover are handled
  // by hit-testing the label rectangles against Cesium's own click/move events
  // — and Cesium's LEFT_CLICK already ignores camera drags, so a drag rotates
  // the globe and never selects a country.
  const layer = document.createElement('div');
  layer.id = 'origin-labels';
  document.body.appendChild(layer);

  const labels = [];
  for (const g of groups.values()) {
    const lng = g.sumLng / g.items.length;
    const lat = g.sumLat / g.items.length;
    const el = document.createElement('div');
    el.className = 'country-label';
    el.textContent = g.name;
    layer.appendChild(el);
    labels.push({
      el,
      group: g,
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      sx: 0,
      sy: 0,
      visible: false,
    });
  }

  const occluder = new Cesium.EllipsoidalOccluder(
    scene.globe.ellipsoid,
    scene.camera.positionWC
  );
  const win = new Cesium.Cartesian2();
  const toLabel = new Cesium.Cartesian3();

  function hide(L) {
    if (L.visible) {
      L.el.style.display = 'none';
      L.visible = false;
    }
  }

  scene.postRender.addEventListener(() => {
    const cam = scene.camera;
    const tooFar = cam.positionCartographic.height > LABEL_MAX_HEIGHT;
    occluder.cameraPosition = cam.positionWC;
    const w = scene.canvas.clientWidth;
    const h = scene.canvas.clientHeight;
    for (const L of labels) {
      // Cull: zoomed too far, occluded by the globe, or behind the camera.
      if (tooFar || !occluder.isPointVisible(L.position)) {
        hide(L);
        continue;
      }
      Cesium.Cartesian3.subtract(L.position, cam.positionWC, toLabel);
      if (Cesium.Cartesian3.dot(toLabel, cam.directionWC) <= 0) {
        hide(L);
        continue;
      }
      const p = Cesium.SceneTransforms.worldToWindowCoordinates(
        scene,
        L.position,
        win
      );
      // Cull anything that projects off-screen (or to NaN).
      if (!p || !(p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h)) {
        hide(L);
        continue;
      }
      if (!L.visible) {
        L.el.style.display = '';
        L.visible = true;
      }
      L.sx = p.x;
      L.sy = p.y;
      L.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
    }
  });

  // Hit-test a screen point against the visible label rectangles.
  function labelAt(x, y) {
    for (const L of labels) {
      if (!L.visible) continue;
      const w = L.el.offsetWidth / 2;
      const h = L.el.offsetHeight / 2;
      if (x >= L.sx - w && x <= L.sx + w && y >= L.sy - h && y <= L.sy + h) {
        return L;
      }
    }
    return null;
  }

  // The disc's resting world position, matching the shader: at prog~0 it sits
  // at `from`, at prog~1 at `to` (from/to swap with reverse). Mid-flight the
  // discs are moving along arcs, so picking is disabled then.
  const discWin = new Cesium.Cartesian2();
  function discRestPosition(d) {
    if (discs.prog > 0.99) return discs.reverse ? d.museum : d.home;
    if (discs.prog < 0.01) return discs.reverse ? d.home : d.museum;
    return null;
  }
  function discAt(x, y) {
    if (discs.prog > 0.01 && discs.prog < 0.99) return null; // mid-flight
    const thresh = discs.pxSize + 5;
    let best = null;
    let bestD2 = thresh * thresh;
    for (const d of discList) {
      const pos = discRestPosition(d);
      if (!pos || !occluder.isPointVisible(pos)) continue;
      const p = Cesium.SceneTransforms.worldToWindowCoordinates(
        scene,
        pos,
        discWin
      );
      if (!p) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = d;
      }
    }
    return best;
  }

  const handler = viewer.screenSpaceEventHandler;
  handler.setInputAction((movement) => {
    const L = labelAt(movement.position.x, movement.position.y);
    if (L) {
      openCountry(L.group);
      return;
    }
    const d = discAt(movement.position.x, movement.position.y);
    if (d) openDetail(artifacts[d.index]);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  let hovered = null;
  handler.setInputAction((movement) => {
    const L = labelAt(movement.endPosition.x, movement.endPosition.y);
    if (L !== hovered) {
      if (hovered) hovered.el.classList.remove('hover');
      if (L) L.el.classList.add('hover');
      hovered = L;
      scene.canvas.style.cursor = L ? 'pointer' : '';
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  function closeUI() {
    panel.classList.remove('open');
    card.root.classList.remove('open');
  }

  return { groups, openCountry, closeUI };
}

// ---- DOM builders ------------------------------------------------------

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'country-panel';
  panel.innerHTML = `
    <div class="cp-head">
      <div>
        <div class="cp-title"></div>
        <div class="cp-count"></div>
      </div>
      <button class="cp-close" aria-label="Close">×</button>
    </div>
    <div class="cp-hint">Select an image to open its full museum card.</div>
    <div class="cp-grid"></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector('.cp-close').addEventListener('click', () =>
    panel.classList.remove('open')
  );
  return {
    panel,
    grid: panel.querySelector('.cp-grid'),
    panelTitle: panel.querySelector('.cp-title'),
    panelCount: panel.querySelector('.cp-count'),
  };
}

function buildCard() {
  const root = document.createElement('div');
  root.id = 'detail-card';
  root.innerHTML = `
    <button class="dc-close" aria-label="Close">×</button>
    <div class="dc-img"><img alt=""></div>
    <div class="dc-body">
      <h2 class="dc-name"></h2>
      <div class="dc-origin"></div>
      <dl class="dc-meta"></dl>
      <p class="dc-desc"></p>
      <a class="dc-link" target="_blank" rel="noopener">View at the British Museum ↗</a>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('.dc-close').addEventListener('click', () =>
    root.classList.remove('open')
  );
  return {
    root,
    img: root.querySelector('.dc-img img'),
    name: root.querySelector('.dc-name'),
    origin: root.querySelector('.dc-origin'),
    meta: root.querySelector('.dc-meta'),
    desc: root.querySelector('.dc-desc'),
    link: root.querySelector('.dc-link'),
  };
}

function fillCard(card, a) {
  card.name.textContent = a.name || a.bm_id;
  card.origin.textContent = a.origin || a.origin_country || '';

  // Try the full British Museum media image; fall back to the atlas tile.
  card.img.onerror = () => {
    const { atlas_index: idx, u, v } = a.atlas;
    const sheet = TILES_PER_ROW * 100;
    card.img.onerror = null;
    card.img.removeAttribute('src');
    card.img.parentElement.style.backgroundImage = `url(${ATLAS.sheetUrl(idx)})`;
    card.img.parentElement.style.backgroundSize = `${sheet}% ${sheet}%`;
    card.img.parentElement.style.backgroundPosition = `${(u / (1 - 1 / TILES_PER_ROW)) * 100}% ${(v / (1 - 1 / TILES_PER_ROW)) * 100}%`;
  };
  card.img.parentElement.style.backgroundImage = '';
  card.img.src = a.image_url || '';

  const rows = [
    ['Date', a.date_text || (a.year != null ? String(a.year) : '')],
    ['Material', a.material],
    ['Museum no.', a.museum_number],
  ].filter(([, v]) => v);
  card.meta.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');

  card.desc.textContent = a.description || '';

  const url = a.image_source_url || a.image_url;
  if (url) {
    card.link.href = url;
    card.link.style.display = '';
  } else {
    card.link.style.display = 'none';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}
