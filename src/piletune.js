import * as Cesium from 'cesium';

// A ?dev=1 slider panel to position/size the pile live (applied via shader
// uniforms — no rebuild). Slide to the sweet spot, then read the values off
// the panel and bake them into data.js (PILE_OFFSET_E/N, base height,
// PILE_RADIUS, PILE_TOP).
export function mountPileTuner(discs) {
  const f = discs.pileFrame;

  const el = document.createElement('div');
  el.id = 'pile-tuner';
  el.innerHTML = `
    <div class="pt-title">Pile tuning</div>
    <label>East <input type="range" id="pt-e" min="-120" max="120" step="1" value="0"><span id="pt-ev">0</span>m</label>
    <label>North <input type="range" id="pt-n" min="-120" max="120" step="1" value="0"><span id="pt-nv">0</span>m</label>
    <label>Up <input type="range" id="pt-u" min="-50" max="80" step="1" value="0"><span id="pt-uv">0</span>m</label>
    <label>Spread <input type="range" id="pt-s" min="0.3" max="2" step="0.05" value="1"><span id="pt-sv">1.00</span>×</label>
    <label>Height <input type="range" id="pt-r" min="0.3" max="2" step="0.05" value="1"><span id="pt-rv">1.00</span>×</label>
    <div class="pt-out" id="pt-out"></div>
  `;
  document.body.appendChild(el);

  const $ = (id) => el.querySelector(id);
  const e = $('#pt-e'), n = $('#pt-n'), u = $('#pt-u'), s = $('#pt-s'), r = $('#pt-r');
  const ev = $('#pt-ev'), nv = $('#pt-nv'), uv = $('#pt-uv'), sv = $('#pt-sv'), rv = $('#pt-rv');
  const out = $('#pt-out');

  function apply() {
    const E = parseFloat(e.value);
    const N = parseFloat(n.value);
    const U = parseFloat(u.value);
    ev.textContent = E; nv.textContent = N; uv.textContent = U;
    sv.textContent = parseFloat(s.value).toFixed(2);
    rv.textContent = parseFloat(r.value).toFixed(2);

    // ENU offset -> ECEF shift.
    const shift = new Cesium.Cartesian3(0, 0, 0);
    Cesium.Cartesian3.add(shift, Cesium.Cartesian3.multiplyByScalar(f.east, E, new Cesium.Cartesian3()), shift);
    Cesium.Cartesian3.add(shift, Cesium.Cartesian3.multiplyByScalar(f.north, N, new Cesium.Cartesian3()), shift);
    Cesium.Cartesian3.add(shift, Cesium.Cartesian3.multiplyByScalar(f.up, U, new Cesium.Cartesian3()), shift);
    discs.pileShift = shift;
    discs.pileSpread = parseFloat(s.value);
    discs.pileRise = parseFloat(r.value);

    out.textContent =
      `offsetE += ${E}, offsetN += ${N}, base += ${U}\n` +
      `radius ×${parseFloat(s.value).toFixed(2)}, top ×${parseFloat(r.value).toFixed(2)}`;
  }

  for (const ctrl of [e, n, u, s, r]) ctrl.addEventListener('input', apply);
  apply();
}
