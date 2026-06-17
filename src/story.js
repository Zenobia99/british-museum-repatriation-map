import * as Cesium from 'cesium';
import { flyToHeroView, flyToEntrance } from './museum.js';

// Length of a full run (pile -> home, or home -> pile), in seconds.
const RUN_SECS = 16;

function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

// Drives the disc progress uniform and the camera through the narrative.
// Phase 3 covers the two core passes:
//   returnHome() — stream the artefacts out of the pile to their origins
//   gather()     — reverse: pull them back to the British Museum
export class Story {
  constructor(viewer, discs) {
    this.viewer = viewer;
    this.discs = discs;
    this.phase = 'museum'; // museum | returning | home | gathering
    this._raf = 0;
    // Altitude of the pulled-back world view (metres). Closer than a full
    // earth-from-space shot so the satellite imagery still reads. Tweakable
    // live via `story.globalHeight`.
    this.globalHeight = 1.45e7;
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

  _run(reverse, onDone) {
    cancelAnimationFrame(this._raf);
    this.discs.reverse = reverse;
    this.discs.opacity = 1.0; // ensure discs are visible for the run
    this.discs.prog = 0; // snap to the start (pile end of this direction)
    const t0 = performance.now();
    const tick = () => {
      const raw = Math.min((performance.now() - t0) / (RUN_SECS * 1000), 1);
      this.discs.prog = easeInOutSine(raw);
      if (raw < 1) {
        this._raf = requestAnimationFrame(tick);
      } else if (onDone) {
        onDone();
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  // Pile -> origins. Ends on the pulled-back global view so the viewer can
  // explore the dispersed discs and open their detail cards. (No descent here
  // — the street-level entrance is the closing beat of the gather pass.)
  returnHome() {
    this.phase = 'returning';
    this.flyGlobal();
    this._run(0.0, () => {
      this.phase = 'home';
    });
  }

  // Origins -> pile (fly back to the museum). When everything is back in the
  // pile, fly the camera home to the British Museum and then descend to a
  // street-level view of the entrance — the closing shot.
  gather() {
    this.phase = 'gathering';
    this.flyGlobal();
    this._run(1.0, () => {
      this.phase = 'museum';
      flyToHeroView(this.viewer, /* animate */ true); // fly back to the museum
      setTimeout(() => {
        flyToEntrance(this.viewer); // descend to the entrance
        // The artefacts are back in the collection — fade the pile out so the
        // closing entrance frame is a clean shot of the building.
        this._fadeDiscs(0.0, 3.5);
      }, 3200);
    });
  }

  // Snap to the piled state at the museum without animating (opening shot).
  pileNow() {
    cancelAnimationFrame(this._raf);
    this.discs.reverse = 0;
    this.discs.prog = 0;
    this.phase = 'museum';
  }
}
