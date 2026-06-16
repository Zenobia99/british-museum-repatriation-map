import * as Cesium from 'cesium';
import { flyToEntrance } from './museum.js';

// A lightweight on-screen tuning panel, shown only when the URL has ?dev=1.
// Lets you adjust disc size/shape and capture camera poses without the
// browser console.
export function mountDevPanel(viewer, discs, story) {
  const wrap = document.createElement('div');
  wrap.id = 'dev';
  wrap.innerHTML = `
    <div class="dev-row"><label>Disc radius</label><input type="range" id="d-size" min="1" max="16" step="0.5"><span id="d-size-v"></span></div>
    <div class="dev-row"><label>Disc aspect</label><input type="range" id="d-aspect" min="0.5" max="2" step="0.02"><span id="d-aspect-v"></span></div>
    <div class="dev-row"><label>World height</label><input type="range" id="d-height" min="5" max="25" step="0.5"><span id="d-height-v"></span></div>
    <div class="dev-buttons">
      <button id="d-global">World view</button>
      <button id="d-entrance">Entrance</button>
      <button id="d-cam">Log camera</button>
    </div>
    <textarea id="d-out" readonly placeholder="camera pose appears here"></textarea>
  `;
  document.body.appendChild(wrap);

  const $ = (id) => wrap.querySelector(id);
  const size = $('#d-size');
  const sizeV = $('#d-size-v');
  const aspect = $('#d-aspect');
  const aspectV = $('#d-aspect-v');
  const height = $('#d-height');
  const heightV = $('#d-height-v');
  const out = $('#d-out');

  size.value = discs.pxSize;
  sizeV.textContent = discs.pxSize;
  aspect.value = discs.aspect;
  aspectV.textContent = discs.aspect.toFixed(2);
  height.value = (story.globalHeight / 1e6).toFixed(1);
  heightV.textContent = (story.globalHeight / 1e6).toFixed(1) + ' Mm';

  size.addEventListener('input', () => {
    discs.pxSize = parseFloat(size.value);
    sizeV.textContent = size.value;
  });
  aspect.addEventListener('input', () => {
    discs.aspect = parseFloat(aspect.value);
    aspectV.textContent = parseFloat(aspect.value).toFixed(2);
  });
  height.addEventListener('input', () => {
    story.globalHeight = parseFloat(height.value) * 1e6;
    heightV.textContent = parseFloat(height.value).toFixed(1) + ' Mm';
  });

  $('#d-global').addEventListener('click', () => story.flyGlobal());
  $('#d-entrance').addEventListener('click', () => flyToEntrance(viewer));
  $('#d-cam').addEventListener('click', () => {
    const c = viewer.camera;
    const carto = c.positionCartographic;
    out.value =
      `destination: Cesium.Cartesian3.fromDegrees(\n` +
      `  ${Cesium.Math.toDegrees(carto.longitude)},\n` +
      `  ${Cesium.Math.toDegrees(carto.latitude)},\n` +
      `  ${carto.height}),\n` +
      `heading: ${Cesium.Math.toDegrees(c.heading).toFixed(3)}\n` +
      `pitch:   ${Cesium.Math.toDegrees(c.pitch).toFixed(3)}\n` +
      `roll:    ${Cesium.Math.toDegrees(c.roll).toFixed(3)}`;
    out.select();
  });
}
