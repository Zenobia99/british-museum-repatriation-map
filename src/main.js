import './style.css';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { MUSEUM, flyToMuseum, logCam } from './museum.js';
import { addBorders } from './borders.js';
import { loadArtifacts, buildPositions, pileFrame } from './artifacts/data.js';
import { addPhotoDiscs } from './artifacts/discs.js';
import { mountPileTuner } from './piletune.js';
import { Story } from './story.js';
import { initExplore } from './explore.js';
import { mountCameraControls } from './controls.js';
import { addGoogleTiles } from './tiles.js';

// Visible build stamp so it's obvious which version is actually running
// (defeats stale dev-server / service-worker confusion).
const BUILD = 'v18 — pile baked';
console.log(`%c[Return Them Home] build ${BUILD}`, 'color:#e8b24a;font-weight:bold');
window.addEventListener('DOMContentLoaded', () => {
  const stamp = document.createElement('div');
  stamp.id = 'build-stamp';
  stamp.textContent = BUILD;
  document.body.appendChild(stamp);
});

// Cesium Ion powers world-scale satellite imagery and terrain. The token is
// read from the environment (VITE_CESIUM_ION_TOKEN) — never hard-coded, never
// committed. Without a token we fall back to token-free imagery.
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
const hasIon = typeof ION_TOKEN === 'string' && ION_TOKEN.length > 0;
if (hasIon) Cesium.Ion.defaultAccessToken = ION_TOKEN;

// Surface fatal errors on screen instead of failing silently to a blank page.
function showError(msg) {
  let el = document.getElementById('fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal';
    el.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'z-index:9999;max-width:560px;background:rgba(40,10,10,0.92);' +
      'border:1px solid #a33;border-radius:10px;padding:20px 24px;' +
      'font:14px/1.5 monospace;color:#ffd;white-space:pre-wrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

function addOpenStreetMap(viewer) {
  viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
    })
  );
}

async function init() {
  // Build the viewer with NO base layer so construction can't fail on a flaky
  // imagery/terrain provider; we add those afterwards, each guarded.
  const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayer: false,
    fullscreenButton: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    geocoder: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    infoBox: false,
    selectionIndicator: false,
    navigationInstructionsInitiallyVisible: false,
    scene3DOnly: true,
  });
  window.viewer = viewer;

  // Report any later render-loop error on screen (Cesium halts on these).
  viewer.scene.renderError.addEventListener((scene, err) => {
    showError('Render error:\n' + (err && err.message ? err.message : err));
  });

  // Imagery + terrain, each guarded so neither can blank the globe.
  if (hasIon) {
    try {
      const imagery = await Cesium.createWorldImageryAsync({
        style: Cesium.IonWorldImageryStyle.AERIAL,
      });
      viewer.imageryLayers.addImageryProvider(imagery);
    } catch (e) {
      console.warn('[return-them-home] world imagery failed, using OSM:', e);
      addOpenStreetMap(viewer);
    }
    try {
      viewer.scene.setTerrain(
        Cesium.Terrain.fromWorldTerrain({
          requestVertexNormals: true,
          requestWaterMask: true,
        })
      );
    } catch (e) {
      console.warn('[return-them-home] world terrain failed:', e);
    }
  } else {
    console.warn(
      '[return-them-home] No VITE_CESIUM_ION_TOKEN — using OpenStreetMap imagery.'
    );
    addOpenStreetMap(viewer);
  }

  // Cinematic atmosphere.
  const scene = viewer.scene;
  scene.msaaSamples = 4; // smoother building/border/disc geometry edges
  scene.globe.enableLighting = true;

  // Camera controls: zoom from close-to-the-building out to deep space, with
  // collision detection ON so the camera can't be driven under the terrain.
  const ctrl = scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 30.0;
  ctrl.maximumZoomDistance = 4.0e7;
  ctrl.enableCollisionDetection = true;
  scene.skyAtmosphere.show = true;
  scene.sun.show = true;
  scene.moon.show = true;
  scene.fog.enabled = true;
  viewer.cesiumWidget.creditContainer.style.display = 'none';

  // Photorealistic 3D Tiles for the street-level view. Google's tiles already
  // contain the British Museum in full photogrammetry, so we no longer add a
  // separate model — we just pile the discs onto the real building.
  await addGoogleTiles(viewer);

  // Sample the actual surface height at the museum (London sits ~50m up in
  // ellipsoidal height due to the geoid; a fixed offset would bury the pile).
  let pileBase = 60;
  if (viewer.scene.sampleHeightSupported) {
    try {
      const carto = Cesium.Cartographic.fromDegrees(MUSEUM.lon, MUSEUM.lat);
      const [sampled] = await viewer.scene.sampleHeightMostDetailed([carto]);
      if (sampled && isFinite(sampled.height)) pileBase = sampled.height - 3;
    } catch (e) {
      console.warn('[return-them-home] surface height sample failed:', e);
    }
  }

  // Open on the comfortable oblique museum view (orbit/zoom controls available).
  flyToMuseum(viewer, /* animate */ false);

  // Country borders (Natural Earth 110m), guarded.
  try {
    await addBorders(viewer);
  } catch (e) {
    console.warn('[return-them-home] borders failed:', e);
  }

  // Phase 2: load the 5,000 artefacts and render them as photo-discs.
  const artifacts = await loadArtifacts();
  const { groups, yearRange } = buildPositions(artifacts, pileBase);
  const discs = addPhotoDiscs(viewer, groups, pileFrame(pileBase));

  // Phase 3: the narrative. Open piled on the museum; stream home / watch how
  // they were taken / gather on the buttons.
  const story = new Story(viewer, discs, yearRange);
  story.pileNow();

  // Phase 4: clickable country labels + disc clicks -> thumbnail panel /
  // detail card. The flat disc list (with home/museum positions) is passed so
  // discs can be picked at rest.
  const explore = initExplore(viewer, artifacts, groups.flat(), discs);

  // Starting a new pass closes any open panel/card so stale UI doesn't linger.
  const run = (fn) => () => {
    explore.closeUI();
    fn();
  };
  document
    .getElementById('btn-return')
    .addEventListener('click', run(() => story.returnHome()));
  document
    .getElementById('btn-taken')
    .addEventListener('click', run(() => story.watchTaken()));
  document
    .getElementById('btn-gather')
    .addEventListener('click', run(() => story.gather()));

  // Persistent zoom/rotate controls, available in every section of the app.
  mountCameraControls(viewer);

  // Pile tuning sliders when ?dev=1 is in the URL.
  if (new URLSearchParams(location.search).has('dev')) {
    mountPileTuner(discs);
  }

  window.discs = discs;
  window.story = story;
  // Console helper for capturing a camera pose live.
  window.logCam = () => logCam(viewer);
}

init().catch((err) => {
  console.error('[return-them-home] init failed:', err);
  showError('Startup failed:\n' + (err && err.stack ? err.stack : err));
});
