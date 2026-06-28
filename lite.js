// Return Them Home — Lite. A dependency-light 2D Canvas map for phones and
// low-power devices: no WebGL, no Cesium, no 3D tiles. Plots the 5,000 British
// Museum artefacts on an equirectangular world map and animates them home.
import { feature } from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';

const LONDON = { lng: -0.1276, lat: 51.5194 };
const RUN_MS = 14000;
const STAGGER = 5.0;
const SCATTER_DEG = 0.28; // small per-object spread around the origin

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const yearEl = document.getElementById('year');

let W = 0, H = 0, dpr = 1;
let mapW = 0, mapH = 0, ox0 = 0, oy0 = 0;
let mapCanvas = null; // prerendered basemap
let arts = [];        // { ox, oy, ord, ordTake, a }
let yearRange = { min: 1800, max: 2000 };
let world = null;     // cached GeoJSON for re-layout on resize

let prog = 0;     // 0 = piled at London, 1 = home
let useTake = 0;  // 0 = distance order, 1 = acquisition-year order
let raf = 0;

// ---- helpers ----------------------------------------------------------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function parseAcqYear(mn) {
  if (!mn) return null;
  const m = String(mn).match(/(1[5-9]\d{2}|20\d{2})/);
  if (!m) return null;
  const y = +m[1];
  return y >= 1500 && y <= 2025 ? y : null;
}
const easeInOut = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
function project(lng, lat) {
  return [ox0 + ((lng + 180) / 360) * mapW, oy0 + ((90 - lat) / 180) * mapH];
}

// ---- layout / basemap -------------------------------------------------
function resize(world) {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  mapW = Math.min(W, H * 2);
  mapH = mapW / 2;
  ox0 = (W - mapW) / 2;
  oy0 = (H - mapH) / 2;

  if (world) {
    prerenderMap(world);
    computePositions();
  }
}

function prerenderMap(world) {
  mapCanvas = document.createElement('canvas');
  mapCanvas.width = W * dpr;
  mapCanvas.height = H * dpr;
  const m = mapCanvas.getContext('2d');
  m.setTransform(dpr, 0, 0, dpr, 0, 0);

  m.fillStyle = '#0b0d10';
  m.fillRect(0, 0, W, H);
  // ocean panel
  m.fillStyle = '#10161d';
  m.fillRect(ox0, oy0, mapW, mapH);

  m.beginPath();
  for (const f of world.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = project(ring[i][0], ring[i][1]);
          if (i === 0) m.moveTo(x, y);
          else m.lineTo(x, y);
        }
        m.closePath();
      }
    }
  }
  m.fillStyle = '#222a33';      // land
  m.fill('evenodd');
  m.lineWidth = 0.5;
  m.strokeStyle = 'rgba(150,170,190,0.35)'; // borders
  m.stroke();
}

function computePositions() {
  for (const r of arts) {
    const a = r.a;
    [r.ox, r.oy] = project(a._lng, a._lat);
  }
}

// ---- data -------------------------------------------------------------
async function load() {
  const [artifacts, topo] = await Promise.all([
    fetch('data/artifacts.json').then((r) => r.json()),
    fetch('data/countries-110m.json').then((r) => r.json()),
  ]);
  world = feature(topo, topo.objects.countries);

  const flat = [];
  artifacts.forEach((a, i) => {
    const jit = mulberry(i + 777);
    a._lng = a.lng + (jit() - 0.5) * 2 * SCATTER_DEG;
    a._lat = a.lat + (jit() - 0.5) * 2 * SCATTER_DEG;
    const dist = Math.hypot(a.lng - LONDON.lng, a.lat - LONDON.lat);
    const year = parseAcqYear(a.museum_number);
    const r = { a, ox: 0, oy: 0, ord: 0, ordTake: 0 };
    arts.push(r);
    flat.push({ r, dist, year: year == null ? 9999 : year, hasYear: year != null });
  });

  const last = Math.max(flat.length - 1, 1);
  flat.sort((p, q) => p.dist - q.dist).forEach((p, i) => (p.r.ord = i / last));
  flat.sort((p, q) => p.year - q.year).forEach((p, i) => (p.r.ordTake = i / last));
  const years = flat.filter((p) => p.hasYear).map((p) => p.year);
  if (years.length) yearRange = { min: Math.min(...years), max: Math.max(...years) };

  resize(world);
  document.getElementById('loading').remove();
  render();
}

// ---- render -----------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, W, H);
  if (mapCanvas) ctx.drawImage(mapCanvas, 0, 0, W, H);

  const [lx, ly] = project(LONDON.lng, LONDON.lat);
  ctx.fillStyle = '#ecd9bf';
  const s = Math.max(1.5, Math.min(W, H) * 0.0032);

  for (const r of arts) {
    const ord = useTake ? r.ordTake : r.ord;
    const t = Math.min(Math.max(prog * (1 + STAGGER) - ord * STAGGER, 0), 1);
    // 2D arc: quadratic bezier bowing upward, London -> origin.
    const mx = (lx + r.ox) / 2;
    const my = (ly + r.oy) / 2;
    const lift = Math.min(Math.hypot(r.ox - lx, r.oy - ly) * 0.28, mapH * 0.34);
    const cx = mx;
    const cy = my - lift;
    const u = 1 - t;
    const x = u * u * lx + 2 * u * t * cx + t * t * r.ox;
    const y = u * u * ly + 2 * u * t * cy + t * t * r.oy;
    r.cx = x;
    r.cy = y;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
}

// ---- animation --------------------------------------------------------
function animate(toTake) {
  cancelAnimationFrame(raf);
  useTake = toTake;
  prog = 0;
  yearEl.classList.toggle('show', !!toTake);
  const t0 = performance.now();
  const tick = (now) => {
    const raw = Math.min((now - t0) / RUN_MS, 1);
    prog = easeInOut(raw);
    if (toTake) {
      yearEl.textContent = Math.round(
        yearRange.min + (yearRange.max - yearRange.min) * prog
      );
    }
    render();
    if (raw < 1) raf = requestAnimationFrame(tick);
    else onArrived();
  };
  raf = requestAnimationFrame(tick);
}

function onArrived() {
  // Both passes end "home" (origins). The gold button resets.
  setGold('Reset', reset);
  if (useTake) setTimeout(() => yearEl.classList.remove('show'), 1200);
}

function reset() {
  cancelAnimationFrame(raf);
  useTake = 0;
  prog = 0;
  yearEl.classList.remove('show');
  render();
  setGold('Return them home', () => animate(0));
}

// ---- UI ---------------------------------------------------------------
const goldBtn = document.getElementById('btn-home');
function setGold(label, fn) {
  goldBtn.textContent = label;
  goldBtn.onclick = () => { closeCard(); fn(); };
}
setGold('Return them home', () => animate(0));
document.getElementById('btn-taken').onclick = () => { closeCard(); animate(1); };

// ---- detail card ------------------------------------------------------
const card = document.getElementById('card');
const cardImg = card.querySelector('.card-img img');
const cardName = card.querySelector('.card-name');
const cardOrigin = card.querySelector('.card-origin');
const cardMeta = card.querySelector('.card-meta');
const cardDesc = card.querySelector('.card-desc');
const cardLink = card.querySelector('.card-link');
document.getElementById('card-close').onclick = closeCard;
function closeCard() { card.hidden = true; }

function openCard(a) {
  cardName.textContent = a.name || a.bm_id || 'Object';
  cardOrigin.textContent = a.origin || a.origin_country || '';
  cardImg.src = a.image_url || '';
  cardImg.style.display = a.image_url ? '' : 'none';
  const rows = [
    ['Date', a.date_text || (a.year != null ? String(a.year) : '')],
    ['Material', a.material],
    ['Museum no.', a.museum_number],
  ].filter(([, v]) => v);
  cardMeta.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
    .join('');
  cardDesc.textContent = a.description || '';
  const url = a.image_source_url || a.image_url;
  cardLink.style.display = url ? '' : 'none';
  if (url) cardLink.href = url;
  card.hidden = false;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- tap to select ----------------------------------------------------
let downX = 0, downY = 0;
canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return; // was a drag
  const x = e.clientX, y = e.clientY;
  const R = 16;
  let best = null, bestD2 = R * R;
  for (const r of arts) {
    if (r.cx == null) continue;
    const d2 = (r.cx - x) ** 2 + (r.cy - y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = r; }
  }
  if (best) openCard(best.a);
});

// ---- boot -------------------------------------------------------------
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (!world) return;
    resize(world); // rebuild basemap + positions at the new size, keep prog
    render();
  }, 150);
});

load().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Failed to load: ' + err.message;
});
