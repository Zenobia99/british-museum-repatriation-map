import './style.css';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { addMuseum, flyToHeroView, flyToEntrance, logCam } from './museum.js';
import { addBorders } from './borders.js';
import { loadArtifacts, buildPositions } from './artifacts/data.js';
import { addPhotoDiscs } from './artifacts/discs.js';
import { Story } from './story.js';
import { mountDevPanel } from './devpanel.js';
import { initExplore } from './explore.js';

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
  scene.skyAtmosphere.show = true;
  scene.sun.show = true;
  scene.moon.show = true;
  scene.fog.enabled = true;
  viewer.cesiumWidget.creditContainer.style.display = 'none';

  // Phase 1: seat the real British Museum at Bloomsbury and open on the hero
  // view.
  await addMuseum(viewer);
  flyToHeroView(viewer, /* animate */ false);

  // Country borders (Natural Earth 110m), guarded.
  try {
    await addBorders(viewer);
  } catch (e) {
    console.warn('[return-them-home] borders failed:', e);
  }

  // Phase 2: load the 5,000 artefacts and render them as photo-discs.
  const artifacts = await loadArtifacts();
  const groups = buildPositions(artifacts);
  const discs = addPhotoDiscs(viewer, groups);

  // Phase 4: clickable country labels -> thumbnail panel -> detail card.
  initExplore(viewer, artifacts);

  // Phase 3: the narrative. Open piled on the museum, stream home / gather on
  // the buttons.
  const story = new Story(viewer, discs);
  story.pileNow();
  document
    .getElementById('btn-return')
    .addEventListener('click', () => story.returnHome());
  document
    .getElementById('btn-gather')
    .addEventListener('click', () => story.gather());

  window.discs = discs;
  window.story = story;
  // Console helpers for framing the entrance shot live.
  window.logCam = () => logCam(viewer);
  window.flyToEntrance = () => flyToEntrance(viewer);

  // On-screen tuning panel (sliders + camera readout) when ?dev=1 is in the URL.
  if (new URLSearchParams(location.search).has('dev')) {
    mountDevPanel(viewer, discs, story);
  }
}

init().catch((err) => {
  console.error('[return-them-home] init failed:', err);
  showError('Startup failed:\n' + (err && err.stack ? err.stack : err));
});
