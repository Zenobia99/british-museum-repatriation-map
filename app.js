/*
 * Return Them Home — cinematic 3D globe.
 *
 * The experience, modelled on the viral "return the artefacts" video:
 *   1. 5,000 real artefact photographs sit piled on the British Museum.
 *   2. One button sends them streaming home along glowing great-circle arcs.
 *   3. A second pass replays the taking, ordered by acquisition year.
 *
 * All 5,000 points are textured from five 2048px atlas sheets and animated
 * entirely on the GPU: the vertex shader slerps each point between its
 * Bloomsbury pile slot and its true origin, staggered per-object.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as topojson from 'topojson-client';

window.__appJsLoaded = true; // checked by the boot watchdog in index.html

const R = 100;
const BM = { lat: 51.5194, lng: -0.1269 };
const STAGGER = 6.0; // flight spread: each object flies for 1/(1+S) of the run
const RETURN_SECS = 16;
const TAKE_SECS = 14;
const GOLD = new THREE.Color('#e8b14a');

const $ = (id) => document.getElementById(id);

// Safe mode: reduced GPU load (no AA, DPR 1, no mipmaps, no trails).
// Entered manually via ?safe=1 or automatically after a lost WebGL context.
const SAFE = new URLSearchParams(location.search).has('safe');
let appStarted = false;

function latLngToV3(lat, lng, r, out = new THREE.Vector3()) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return out.set(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseAcqYear(museumNumber) {
  const m = /(1[6-9]\d\d|20[0-2]\d)/.exec(museumNumber || '');
  return m ? +m[1] : null;
}

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ----------------------------------------------------------------- boot */

const bootSub = $('boot-sub');
const bootFill = $('boot-bar-fill');
let bootUnits = 0;
const BOOT_TOTAL = 8; // 2 json + 5 atlas + 1 earth
function bootTick(msg) {
  bootUnits++;
  bootFill.style.width = `${Math.round((bootUnits / BOOT_TOTAL) * 100)}%`;
  if (msg) bootSub.textContent = msg;
}

function fatal(err) {
  $('boot').classList.add('gone');
  $('fallback').hidden = false;
  if (err) {
    const card = document.querySelector('.fallback-card p');
    if (card) card.textContent = `Error: ${err.message || err}`;
  }
}

// Surface startup crashes from OUR code in the fallback card — but ignore
// errors from browser extensions and other scripts, which must not kill the app.
addEventListener('error', (e) => {
  const src = e.filename || '';
  if (!appStarted && (src.includes('app.js') || src.includes('jsdelivr'))) {
    fatal(e.error || e.message);
  }
});

async function loadJSON(url, msg) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const j = await r.json();
  bootTick(msg);
  return j;
}

function loadTexture(url, msg) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => { bootTick(msg); resolve(t); },
      undefined,
      reject
    );
  });
}

/* ----------------------------------------------------------------- main */

async function main() {
  const host = $('globe-host');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    return fatal(e);
  }
  renderer.setPixelRatio(SAFE ? 1 : Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  host.appendChild(renderer.domElement);

  // Software renderers (SwiftShader etc.) can't carry the full scene — treat as safe mode
  let lite = SAFE;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|software|llvmpipe/i.test(gpu)) {
      lite = true;
      renderer.setPixelRatio(1);
    }
  } catch { /* detection only */ }

  // A lost context is recoverable: three.js rebuilds on restore. Never show
  // the fallback for it — wait for restore, and only reload as a last resort.
  let ctxLostAt = 0;
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ctxLostAt = performance.now();
    bootSub.textContent = 'Graphics interrupted — recovering…';
    $('boot').classList.remove('gone');
    setTimeout(() => {
      if (ctxLostAt && !SAFE && !sessionStorage.getItem('bm-safe-retry')) {
        sessionStorage.setItem('bm-safe-retry', '1');
        location.replace(location.pathname + '?safe=1');
      }
    }, 6000);
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    ctxLostAt = 0;
    $('boot').classList.add('gone');
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#04060d');
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 5000);
  const bmDir = latLngToV3(BM.lat, BM.lng, 1).normalize();
  camera.position.copy(bmDir).multiplyScalar(235);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 118;
  controls.maxDistance = 480;
  controls.rotateSpeed = 0.55;
  controls.enablePan = false;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.35;

  /* ------------------------------------------------ data + textures */

  const [artifacts, world, earthTex, ...atlasTex] = await Promise.all([
    loadJSON('data/artifacts.json', 'Reading the ledger…'),
    loadJSON('data/countries-110m.json', 'Tracing borders…'),
    loadTexture('assets/earth-blue-marble.jpg', 'Painting the earth…'),
    ...[0, 1, 2, 3, 4].map((i) =>
      loadTexture(`assets/bm/atlas/atlas_${i}.jpg`, 'Photographing 5,000 objects…')
    ),
  ]);

  // Textures stay untagged (no sRGB decode): our raw ShaderMaterials write
  // straight to the canvas, so sampling raw sRGB keeps photos true to source.
  for (const t of atlasTex) {
    t.flipY = false;
    t.generateMipmaps = !lite;
    t.minFilter = lite ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
  }

  const N = artifacts.length;

  /* ------------------------------------------------ earth + borders */

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 96),
    new THREE.ShaderMaterial({
      uniforms: { uTex: { value: earthTex } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vec3 tex = texture2D(uTex, vUv).rgb;
          vec3 col = pow(tex, vec3(1.15)) * vec3(0.42, 0.50, 0.62);
          float fres = pow(1.0 - max(dot(vN, vV), 0.0), 2.6);
          col += fres * vec3(0.16, 0.30, 0.52);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  scene.add(earth);

  // Soft atmosphere halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.16, 64, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        void main() {
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        void main() {
          float i = pow(max(0.62 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 3.5);
          gl_FragColor = vec4(vec3(0.22, 0.42, 0.85) * i, i);
        }`,
    })
  );
  if (!lite) scene.add(halo);

  // Country borders as faint luminous lines (decorative — never fatal)
  try {
    const mesh = topojson.mesh(world, world.objects.countries);
    const verts = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const line of mesh.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        latLngToV3(line[i][1], line[i][0], R + 0.18, a);
        latLngToV3(line[i + 1][1], line[i + 1][0], R + 0.18, b);
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    scene.add(new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({
        color: 0x55688f,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    ));
  } catch (e) {
    console.warn('borders skipped:', e);
  }

  // Starfield
  {
    const rng = mulberry(7);
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
        .normalize()
        .multiplyScalar(1400 + rng() * 1600);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9fb4d8, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0.6, depthWrite: false,
    })));
  }

  // Museum beacon: a thin gold pillar of light over Bloomsbury
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 1.1, 26, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: GOLD, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  {
    const base = bmDir.clone().multiplyScalar(R + 13);
    beacon.position.copy(base);
    beacon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bmDir);
  }
  scene.add(beacon);

  /* ------------------------------------------------ artefact geometry */

  const museumPos = new Float32Array(N * 3);
  const homePos = new Float32Array(N * 3);
  const acqYears = new Float32Array(N);
  const rng = mulberry(1753);

  // Pile: sunflower spiral mound on the tangent plane at the museum
  const east = new THREE.Vector3(0, 1, 0).cross(bmDir).normalize();
  const north = bmDir.clone().cross(east).normalize();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const f = i / N;
    const rad = 7.5 * Math.sqrt(f);
    const ang = i * 2.39996323;
    const mound = 2.6 * Math.exp(-(rad * rad) / 18) * (0.35 + 0.65 * rng());
    tmp.copy(bmDir)
      .multiplyScalar(R)
      .addScaledVector(east, rad * Math.cos(ang))
      .addScaledVector(north, rad * Math.sin(ang));
    tmp.normalize().multiplyScalar(R + 0.4 + mound);
    museumPos.set([tmp.x, tmp.y, tmp.z], i * 3);
  }

  // Origins, with a small deterministic spiral for stacked coordinates
  {
    const seen = new Map();
    for (let i = 0; i < N; i++) {
      const a = artifacts[i];
      const key = `${a.lat.toFixed(2)},${a.lng.toFixed(2)}`;
      const k = seen.get(key) || 0;
      seen.set(key, k + 1);
      const jr = 0.22 * Math.sqrt(k);
      const ja = k * 2.39996323;
      latLngToV3(
        a.lat + jr * Math.sin(ja),
        a.lng + (jr * Math.cos(ja)) / Math.max(Math.cos((a.lat * Math.PI) / 180), 0.2),
        R + 0.45,
        tmp
      );
      homePos.set([tmp.x, tmp.y, tmp.z], i * 3);
      const y = parseAcqYear(a.museum_number);
      acqYears[i] = y ?? 1880 + Math.floor(rng() * 60);
    }
  }

  // Return order: nearest origins receive theirs first (a spreading wave)
  const v = new THREE.Vector3();
  const angDist = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    v.fromArray(homePos, i * 3).normalize();
    angDist[i] = Math.acos(THREE.MathUtils.clamp(v.dot(bmDir), -1, 1));
  }
  const byDist = [...Array(N).keys()].sort((p, q) => angDist[p] - angDist[q]);
  const byYear = [...Array(N).keys()].sort((p, q) => acqYears[p] - acqYears[q]);
  const ordReturn = new Float32Array(N);
  const ordTake = new Float32Array(N);
  byDist.forEach((idx, rank) => (ordReturn[idx] = rank / (N - 1)));
  byYear.forEach((idx, rank) => (ordTake[idx] = rank / (N - 1)));
  const acqSorted = byYear.map((i) => acqYears[i]);

  // Shared animation uniforms (one object, referenced by every material)
  const anim = {
    uProg: { value: 1 },
    uReverse: { value: 1 }, // start settled at the museum
    uUseTake: { value: 0 },
    uTime: { value: 0 },
    uProjScale: { value: 1 },
  };

  const VERT = /* glsl */ `
    attribute vec3 aMuseum;
    attribute vec3 aHome;
    attribute vec2 aTile;
    attribute float aOrdReturn;
    attribute float aOrdTake;
    attribute float aRand;
    attribute float aDim;
    uniform float uProg, uReverse, uUseTake, uTime, uProjScale;
    uniform float uTrailShift, uSize;
    varying vec2 vTile;
    varying float vAlpha, vFlight;

    const float PI = 3.14159265;
    const float S = ${STAGGER.toFixed(1)};

    vec3 arcPoint(vec3 p0, vec3 p1, float t) {
      float r0 = length(p0), r1 = length(p1);
      vec3 a = p0 / r0, b = p1 / r1;
      float c = clamp(dot(a, b), -1.0, 1.0);
      float ang = acos(c);
      vec3 dir;
      if (ang < 1e-3) {
        dir = normalize(mix(a, b, t));
      } else {
        dir = (sin((1.0 - t) * ang) * a + sin(t * ang) * b) / sin(ang);
      }
      float lift = (4.0 + 26.0 * ang / PI) * sin(PI * t);
      return dir * (mix(r0, r1, t) + lift);
    }

    void main() {
      float ord = mix(aOrdReturn, aOrdTake, uUseTake);
      float t = clamp(uProg * (1.0 + S) - ord * S - uTrailShift, 0.0, 1.0);
      float tMain = clamp(uProg * (1.0 + S) - ord * S, 0.0, 1.0);
      vec3 from = mix(aMuseum, aHome, uReverse);
      vec3 to = mix(aHome, aMuseum, uReverse);
      vec3 p = arcPoint(from, to, t);

      vFlight = step(0.0001, tMain) * step(tMain, 0.9999);
      vTile = aTile;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float size = uSize * (1.0 - 0.35 * aDim);
      size *= 1.0 + 0.10 * sin(uTime * 1.7 + aRand * 6.283);
      gl_PointSize = clamp(size * uProjScale / -mv.z, 1.5, 22.0);
      vAlpha = 1.0 - 0.92 * aDim;
      gl_Position = projectionMatrix * mv;
    }`;

  const FRAG_PHOTO = /* glsl */ `
    uniform sampler2D uAtlas;
    uniform float uTileScale;
    varying vec2 vTile;
    varying float vAlpha, vFlight;
    void main() {
      vec2 pc = gl_PointCoord;
      float r = length(pc - 0.5);
      if (r > 0.5) discard;
      vec3 photo = texture2D(uAtlas, vTile + pc * uTileScale).rgb;
      float rim = smoothstep(0.36, 0.5, r);
      vec3 col = mix(photo, vec3(0.91, 0.69, 0.29), rim * 0.85);
      col += vFlight * vec3(0.30, 0.20, 0.06); // warm up while airborne
      float edge = smoothstep(0.5, 0.45, r);
      gl_FragColor = vec4(col, edge * vAlpha);
      if (gl_FragColor.a < 0.02) discard;
    }`;

  const FRAG_TRAIL = /* glsl */ `
    varying vec2 vTile; // unused
    varying float vAlpha, vFlight;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      float fall = pow(max(1.0 - r * 2.0, 0.0), 2.0);
      gl_FragColor = vec4(vec3(1.0, 0.74, 0.34) * fall, fall * 0.5 * vFlight * vAlpha);
    }`;

  // Group artefacts by atlas sheet → 5 photo layers + 2 trail echoes each
  const groups = [[], [], [], [], []];
  artifacts.forEach((a, i) => groups[a.atlas.atlas_index].push(i));

  const dimAttrs = []; // [{attr, indices}] for search dimming
  const photoLayers = [];
  const trailLayers = []; // shown only during flight to cut static overdraw

  for (let s = 0; s < 5; s++) {
    const idx = groups[s];
    const n = idx.length;
    if (!n) continue;
    const g = new THREE.BufferGeometry();
    const fill = (name, src, comps) => {
      const arr = new Float32Array(n * comps);
      idx.forEach((ai, j) => {
        for (let c = 0; c < comps; c++) arr[j * comps + c] = src[ai * comps + c];
      });
      g.setAttribute(name, new THREE.BufferAttribute(arr, comps));
      return arr;
    };
    fill('aMuseum', museumPos, 3);
    fill('aHome', homePos, 3);
    g.setAttribute('position', g.getAttribute('aMuseum').clone()); // bounding only
    const tiles = new Float32Array(n * 2);
    const rands = new Float32Array(n);
    idx.forEach((ai, j) => {
      tiles[j * 2] = artifacts[ai].atlas.u;
      tiles[j * 2 + 1] = artifacts[ai].atlas.v;
      rands[j] = mulberry(ai + 11)();
    });
    g.setAttribute('aTile', new THREE.BufferAttribute(tiles, 2));
    g.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));
    fill('aOrdReturn', ordReturn, 1);
    fill('aOrdTake', ordTake, 1);
    const dim = new Float32Array(n);
    const dimAttr = new THREE.BufferAttribute(dim, 1);
    dimAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aDim', dimAttr);
    g.computeBoundingSphere();
    g.boundingSphere.radius = R * 2; // points roam the whole globe

    dimAttrs.push({ attr: dimAttr, indices: idx });

    const mk = (frag, shift, extra) =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...anim,
          uTrailShift: { value: shift },
          uSize: { value: extra.size },
          uAtlas: { value: atlasTex[s] },
          uTileScale: { value: 64 / 2048 },
        },
        vertexShader: VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: extra.depthWrite,
        blending: extra.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });

    if (!lite) {
      for (const [shift, size] of [[0.10, 0.9], [0.05, 1.3]]) {
        const trail = new THREE.Points(g, mk(FRAG_TRAIL, shift, { size, depthWrite: false, additive: true }));
        trail.renderOrder = 1;
        trail.visible = false; // only during flight — avoids huge static overdraw
        scene.add(trail);
        trailLayers.push(trail);
      }
    }
    const photos = new THREE.Points(g, mk(FRAG_PHOTO, 0, { size: 2.7, depthWrite: true, additive: false }));
    photos.renderOrder = 2;
    scene.add(photos);
    photoLayers.push(photos);
  }

  /* ------------------------------------------------ phase machine */

  const act = $('act');
  const actLabel = $('act-label');
  const actGlyph = document.querySelector('.act-glyph');
  const hint = $('stage-hint');
  const ticker = $('ticker');
  const tickerBig = $('ticker-big');
  const tickerSub = $('ticker-sub');

  const totalCountries = new Set(artifacts.map((a) => a.origin_country || a.origin)).size;
  $('stat-total').textContent = N.toLocaleString();
  $('stat-countries').textContent = totalCountries;

  let phase = 'museum'; // museum | returning | home | taking
  let runStart = 0;
  let camTween = null;

  function tweenCameraTo(dir, dist, secs) {
    camTween = {
      from: camera.position.clone(),
      to: dir.clone().normalize().multiplyScalar(dist),
      t0: performance.now(),
      secs,
    };
  }

  function setPhase(p) {
    phase = p;
    const settled = p === 'museum' || p === 'home';
    act.disabled = !settled;
    ticker.hidden = settled;
    // Glow trails only exist mid-flight; hiding them when settled removes
    // ~10,000 blended point-sprites per frame (a GPU-watchdog trigger).
    const flying = p === 'returning' || p === 'taking';
    for (const t of trailLayers) t.visible = flying;
    if (p === 'museum') {
      actGlyph.textContent = '⟿';
      actLabel.textContent = 'Return them home';
      hint.textContent = `${N.toLocaleString()} artefacts are piled on one building in Bloomsbury — drag to look around`;
    } else if (p === 'returning') {
      hint.textContent = 'They are going home…';
      tickerSub.textContent = 'objects returned';
    } else if (p === 'home') {
      actGlyph.textContent = '⟲';
      actLabel.textContent = 'Watch how they were taken';
      hint.textContent = `Every object rests at its origin across ${totalCountries} nations — click any point to meet it`;
    } else if (p === 'taking') {
      hint.textContent = 'Two and a half centuries of acquisition…';
      tickerSub.textContent = 'the year is';
    }
  }

  act.addEventListener('click', () => {
    if (phase === 'museum') {
      anim.uReverse.value = 0;
      anim.uUseTake.value = 0;
      anim.uProg.value = 0;
      runStart = performance.now();
      setPhase('returning');
      tweenCameraTo(camera.position, 330, 3.2);
    } else if (phase === 'home') {
      anim.uReverse.value = 1;
      anim.uUseTake.value = 1;
      anim.uProg.value = 0;
      runStart = performance.now();
      setPhase('taking');
      tweenCameraTo(camera.position, 330, 3.2);
    }
  });

  function arrivalsAt(prog) {
    const thresh = (prog * (1 + STAGGER) - 1) / STAGGER;
    return THREE.MathUtils.clamp(Math.floor(thresh * (N - 1)) + 1, 0, N);
  }

  /* ------------------------------------------------ search / dim */

  const countries = new Map(); // name → [indices]
  artifacts.forEach((a, i) => {
    const c = a.origin_country || a.origin;
    if (!countries.has(c)) countries.set(c, []);
    countries.get(c).push(i);
  });
  const datalist = $('country-list');
  [...countries.keys()].sort().forEach((c) => {
    const o = document.createElement('option');
    o.value = c;
    datalist.appendChild(o);
  });

  const search = $('search');
  const found = $('deck-found');

  function applyDim(selected) {
    for (const { attr, indices } of dimAttrs) {
      for (let j = 0; j < indices.length; j++) {
        attr.array[j] = selected && !selected.has(indices[j]) ? 1 : 0;
      }
      attr.needsUpdate = true;
    }
  }

  function runSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) {
      applyDim(null);
      found.hidden = true;
      return;
    }
    const name = [...countries.keys()].find((c) => c.toLowerCase() === q)
      || [...countries.keys()].find((c) => c.toLowerCase().includes(q));
    if (!name) {
      found.hidden = false;
      found.textContent = 'No nation matches';
      applyDim(null);
      return;
    }
    const idx = countries.get(name);
    applyDim(new Set(idx));
    found.hidden = false;
    found.textContent = `${name} — ${idx.length} object${idx.length > 1 ? 's' : ''}`;
    const centroid = new THREE.Vector3();
    for (const i of idx) centroid.add(v.fromArray(homePos, i * 3));
    centroid.normalize();
    tweenCameraTo(centroid, Math.min(camera.position.length(), 240), 1.4);
  }
  search.addEventListener('change', runSearch);
  search.addEventListener('input', () => { if (!search.value.trim()) runSearch(); });

  /* ------------------------------------------------ rotate / reset */

  const tRotate = $('t-rotate');
  let wantRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  tRotate.setAttribute('aria-pressed', String(wantRotate));
  tRotate.addEventListener('click', () => {
    wantRotate = !wantRotate;
    tRotate.setAttribute('aria-pressed', String(wantRotate));
  });
  $('reset-view').addEventListener('click', () => {
    search.value = '';
    runSearch();
    tweenCameraTo(phase === 'home' || phase === 'returning' ? new THREE.Vector3(0.3, 0.5, 1) : bmDir, 235, 1.4);
  });

  /* ------------------------------------------------ picking */

  const tip = $('tip');
  const detail = $('detail');
  let pointer = { x: -1e4, y: -1e4, moved: false, downAt: null };
  let hovered = -1;

  renderer.domElement.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.moved = true;
  });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointer.downAt = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    const d = pointer.downAt;
    pointer.downAt = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return;
    if (hovered >= 0) openDetail(hovered);
    else detail.hidden = true;
  });
  $('detail-close').addEventListener('click', () => (detail.hidden = true));

  function openDetail(i) {
    const a = artifacts[i];
    $('detail-img').src = a.image_detail || a.image_thumb;
    $('detail-img').alt = a.name;
    $('detail-name').textContent = a.name;
    $('detail-origin').textContent = a.origin_country && a.origin !== a.origin_country
      ? `${a.origin} · ${a.origin_country}` : a.origin;
    $('detail-date').textContent = a.date_text || (a.year < 0 ? `${-a.year} BC` : a.year) || '—';
    $('detail-material').textContent = a.material || '—';
    $('detail-museum').textContent = a.museum_number || a.bm_id;
    const y = parseAcqYear(a.museum_number);
    $('detail-acquired').textContent = y ? `by the British Museum, ${y}` : 'date unrecorded';
    $('detail-license').textContent = a.image_license || '';
    detail.hidden = false;
  }

  const proj = new THREE.Vector3();
  function pick() {
    if (!(phase === 'museum' || phase === 'home')) { hovered = -1; tip.hidden = true; return; }
    const src = phase === 'home' ? homePos : museumPos;
    const w = innerWidth, h = innerHeight;
    const camPos = camera.position;
    let best = -1, bestD = 14 * 14;
    for (let i = 0; i < N; i++) {
      proj.fromArray(src, i * 3);
      // skip far-side points
      if (proj.dot(camPos) < R * R * 0.95) continue;
      proj.project(camera);
      if (proj.z > 1) continue;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      const d = (sx - pointer.x) ** 2 + (sy - pointer.y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    hovered = best;
    if (best >= 0) {
      const a = artifacts[best];
      tip.innerHTML = `<b>${a.name}</b><span>${a.origin_country || a.origin}${a.date_text ? ' · ' + a.date_text : ''}</span>`;
      tip.style.left = `${pointer.x}px`;
      tip.style.top = `${pointer.y}px`;
      tip.hidden = false;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tip.hidden = true;
      renderer.domElement.style.cursor = '';
    }
  }

  /* ------------------------------------------------ loop */

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const clock = new THREE.Clock();
  setPhase('museum');
  $('boot').classList.add('gone');

  function frame() {
    requestAnimationFrame(frame);
    const dt = clock.getDelta();
    anim.uTime.value += dt;
    anim.uProjScale.value =
      (renderer.domElement.clientHeight * 0.5 * camera.projectionMatrix.elements[5]) *
      renderer.getPixelRatio();

    // run the migration
    if (phase === 'returning' || phase === 'taking') {
      const secs = phase === 'returning' ? RETURN_SECS : TAKE_SECS;
      const raw = Math.min((performance.now() - runStart) / (secs * 1000), 1);
      anim.uProg.value = easeInOutSine(raw);
      const k = arrivalsAt(anim.uProg.value);
      if (phase === 'returning') {
        tickerBig.textContent = k.toLocaleString();
      } else {
        tickerBig.textContent = k > 0 ? String(Math.round(acqSorted[k - 1])) : String(Math.round(acqSorted[0]));
      }
      if (raw >= 1) setPhase(phase === 'returning' ? 'home' : 'museum');
    }

    // beacon breathes while the pile is present
    const pileHere = phase === 'museum' || phase === 'taking';
    beacon.material.opacity = pileHere
      ? 0.32 + 0.18 * (0.5 + 0.5 * Math.sin(anim.uTime.value * 1.3))
      : Math.max(beacon.material.opacity - dt * 0.4, 0);

    if (camTween) {
      const t = Math.min((performance.now() - camTween.t0) / (camTween.secs * 1000), 1);
      camera.position.lerpVectors(camTween.from, camTween.to, easeOutCubic(t));
      if (t >= 1) camTween = null;
    }

    controls.autoRotate = wantRotate && (phase === 'home' || phase === 'returning') && !pointer.downAt;
    controls.update();

    if (pointer.moved) { pointer.moved = false; pick(); }

    renderer.render(scene, camera);
    appStarted = true;
  }
  frame();
}

main().catch((err) => {
  console.error(err);
  fatal(err);
});
