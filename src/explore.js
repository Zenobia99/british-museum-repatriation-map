import * as Cesium from 'cesium';
import { ATLAS } from './artifacts/data.js';

// Phase 4 — exploration. Click a country label to open a panel of that
// country's artefacts as atlas thumbnails; click a thumbnail to open the
// detail card. Country labels are generated per origin country at the centroid
// of that country's artefacts, so every one of the ~88 origins is clickable
// and sits on its cluster (no reliance on the 110m label names, and small
// island nations like Sri Lanka work too).

// Normalise/clean the origin_country values into display names, merging
// variants (e.g. "Egypt (Coptic)" -> "Egypt") so they share one label/panel.
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

function displayName(originCountry) {
  return DISPLAY[originCountry] || originCountry || 'Unknown';
}

// Set a thumbnail element's background to the artefact's atlas tile.
function styleThumb(el, art) {
  const { atlas_index: idx, u, v } = art.atlas;
  const sheet = TILES_PER_ROW * THUMB;
  el.style.backgroundImage = `url(${ATLAS.sheetUrl(idx)})`;
  el.style.backgroundSize = `${sheet}px ${sheet}px`;
  el.style.backgroundPosition = `-${u * sheet}px -${v * sheet}px`;
}

export function initExplore(viewer, artifacts) {
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

  // One clickable label per country, at its artefacts' centroid.
  const ds = new Cesium.CustomDataSource('origins');
  const entityCountry = new Map(); // entity.id -> group
  for (const g of groups.values()) {
    const lng = g.sumLng / g.items.length;
    const lat = g.sumLat / g.items.length;
    const e = ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      label: {
        text: g.name,
        font: '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#f4f7fa'),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 3.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.4),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2.6e7),
        translucencyByDistance: new Cesium.NearFarScalar(3.0e6, 1.0, 2.6e7, 0.45),
        scaleByDistance: new Cesium.NearFarScalar(3.0e6, 1.1, 2.0e7, 0.6),
      },
    });
    entityCountry.set(e.id, g);
  }
  viewer.dataSources.add(ds);

  // ---- DOM: country panel + detail card -------------------------------
  const { panel, grid, panelTitle, panelCount } = buildPanel();
  const card = buildCard();

  let openThumbs = [];

  function openCountry(g) {
    panelTitle.textContent = g.name;
    panelCount.textContent = `${g.items.length} object${g.items.length === 1 ? '' : 's'}`;
    grid.innerHTML = '';
    openThumbs = g.items;
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

  // Pointer cursor + click handling on labels.
  const handler = viewer.screenSpaceEventHandler;
  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    if (Cesium.defined(picked) && picked.id && entityCountry.has(picked.id.id)) {
      openCountry(entityCountry.get(picked.id.id));
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return { groups, openCountry };
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
