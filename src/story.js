import * as Cesium from 'cesium';
import { flyToEntrance } from './museum.js';

// Length of a full run (pile -> home, or home -> pile), in seconds.
const RUN_SECS = 16;

function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

// Drives the disc progress uniform and the camera through the narrative:
//   returnHome()  — stream the artefacts out of the pile to their origins
//   watchTaken()  — reverse, ordered by acquisition year, with a year ticker
//   gather()      — reverse by distance, pulled back to the museum
export class Story {
  constructor(viewer, discs, yearRange) {
    this.viewer = viewer;
    this.discs = discs;
    this.yearRange = yearRange || { min: 1800, max: 2000 };
    this.phase = 'museum'; // museum | returning | home | taking | gathering
    this._raf = 0;
    this.globalHeight = 1.45e7;

    // Year ticker overlay (shown during "watch how they were taken").
    this.ticker = document.createElement('div');
    this.ticker.id = 'year-ticker';
    document.body.appendChild(this.ticker);
  }

  // A wide view that frames Europe-Africa-Asia so most arcs are visible.
  flyGlobal(duration = 3.5) {
    const cam = this.viewer.camera;
    cam.cancelFlight(); // avoid overlapping flights leaving input disabled
    cam.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(12.0, 28.0, this.globalHeight),
      orientation: {
        heading: 0.0,
        pitch: Cesium.Math.toRadians(-90.0),
        roll: 0.0,
      },
      duration,
      // Always hand control back, regardless of flyTo's internal save/restore.
      complete: () => this._enableControls(),
      cancel: () => this._enableControls(),
    });
  }

  _enableControls() {
    this.viewer.scene.screenSpaceCameraController.enableInputs = true;
  }

  // Tween the global disc opacity (clean closing frame).
  _fadeDiscs(to, secs) {
    cancelAnimationFrame(this._fadeRaf);
    const from = this.discs.opacity;
    const t0 = performance.now();
    const tick = () => {
      const raw = Math.min((performance.now() - t0) / (secs * 1000), 1);
      this.discs.opacity = from + (to - from) * easeInOutSine(raw);
      if (raw < 1) this._fadeRaf = requestAnimationFrame(tick);
    };
    this._fadeRaf = requestAnimationFrame(tick);
  }

  _run(reverse, useTake, onDone, onProgress) {
    cancelAnimationFrame(this._raf);
    this.discs.reverse = reverse;
    this.discs.useTake = useTake;
    this.discs.opacity = 1.0; // ensure discs are visible for the run
    this.discs.prog = 0; // snap to the start (pile end of this direction)
    const t0 = performance.now();
    const tick = () => {
      const raw = Math.min((performance.now() - t0) / (RUN_SECS * 1000), 1);
      this.discs.prog = easeInOutSine(raw);
      if (onProgress) onProgress(this.discs.prog);
      if (raw < 1) {
        this._raf = requestAnimationFrame(tick);
      } else if (onDone) {
        onDone();
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  // Pile -> origins. Ends on the pulled-back global view so the viewer can
  // explore the dispersed discs and open their detail cards.
  returnHome() {
    this.phase = 'returning';
    this.flyGlobal();
    this._run(0.0, 0.0, () => {
      this.phase = 'home';
    });
  }

  // Origins -> pile, ordered by acquisition year, with a year ticker counting
  // up 1600 -> 2025 as the wave arrives — "watch how they were taken". Ends
  // back at the museum entrance.
  watchTaken() {
    this.phase = 'taking';
    this.flyGlobal();
    this.ticker.classList.add('show');
    this._run(
      1.0,
      1.0,
      () => this._closeOnMuseum(),
      (prog) => {
        const { min, max } = this.yearRange;
        this.ticker.textContent = String(Math.round(min + (max - min) * prog));
      }
    );
  }

  // Origins -> pile by distance, pulled back to the museum.
  gather() {
    this.phase = 'gathering';
    this.flyGlobal();
    this._run(1.0, 0.0, () => this._closeOnMuseum());
  }

  // Shared closing beat: fly back to the museum entrance in a single flight
  // (a single flight avoids overlapping-flight input locks), fade the pile out
  // for a clean final frame, hide the ticker. Controls are handed back when
  // the flight completes (see flyToEntrance).
  _closeOnMuseum() {
    this.phase = 'museum';
    this.ticker.classList.remove('show');
    flyToEntrance(this.viewer);
    this._fadeDiscs(0.0, 3.5);
  }

  // Snap to the piled state at the museum without animating (opening shot).
  pileNow() {
    cancelAnimationFrame(this._raf);
    this.discs.reverse = 0;
    this.discs.useTake = 0;
    this.discs.prog = 0;
    this.phase = 'museum';
  }
}
