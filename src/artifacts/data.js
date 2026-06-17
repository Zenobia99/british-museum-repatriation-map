import * as Cesium from 'cesium';
import { MUSEUM, museumAnchor } from '../museum.js';

// Atlas layout: 5 sheets, 4096px each, packed with 128px tiles -> 32x32 =
// 1024 tiles per sheet. Each object carries a pre-baked { atlas_index, u, v }
// where (u,v) is the normalised top-left of its tile. Because (u,v) are
// normalised, the per-tile UV span (128/4096) is identical to the original
// 64/2048 packing — the higher-res sheets are a pure drop-in.
export const ATLAS = {
  sheets: 5,
  atlasSize: 4096,
  tileSize: 128,
  tileScale: 128 / 4096, // 0.03125
  sheetUrl: (i) => `${import.meta.env.BASE_URL}atlas/atlas_${i}.jpg`,
};

// Altitude (metres) at which the discs hover above their home coordinates.
// Kept low: a high anchor looks fine top-down but, at an oblique angle, its
// apparent ground position shifts sideways (parallax) — which made coastal
// artefacts appear to drift out to sea. Low enough to sit on their country,
// high enough to clear the terrain and read clearly.
const HOME_ALT = 1200;

// Pile geometry around the museum, in local east-north-up metres. A compact
// gaussian swarm hugging the building so artefacts read as leaving it.
const PILE_RADIUS = 70; // metres
const PILE_TOP = 120;
const PILE_FLOOR = 8;

// Deterministic PRNG (mulberry32) so the pile/jitter are stable across runs.
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Load the artefact records.
export async function loadArtifacts() {
  const url = `${import.meta.env.BASE_URL}data/artifacts.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load artifacts.json (${res.status})`);
  return res.json();
}

// Build the per-object world positions in ECEF:
//  - home:   the object's true origin coordinate, lifted to HOME_ALT.
//  - museum: a slot in the pile hugging the British Museum at Bloomsbury.
// Both are absolute ECEF metres (Cartesian3), grouped by atlas sheet so each
// sheet becomes one draw call binding one atlas texture.
export function buildPositions(artifacts) {
  const anchor = museumAnchor();
  // Local frame at the museum to place the pile in east-north-up metres.
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);

  const groups = Array.from({ length: ATLAS.sheets }, () => []);
  const flat = []; // every disc, with its distance from the museum

  artifacts.forEach((a, i) => {
    const rnd = mulberry(i + 11);

    // Home: true origin, lifted slightly off the surface.
    const home = Cesium.Cartesian3.fromDegrees(a.lng, a.lat, HOME_ALT);

    // Museum pile slot: gaussian-ish radial scatter, taller near the centre.
    const f = rnd();
    const rad = PILE_RADIUS * Math.sqrt(f);
    const theta = rnd() * Math.PI * 2;
    const height =
      PILE_FLOOR +
      (PILE_TOP - PILE_FLOOR) *
        Math.exp(-(rad * rad) / (PILE_RADIUS * PILE_RADIUS * 0.5)) *
        (0.6 + 0.4 * rnd());
    const local = new Cesium.Cartesian3(
      Math.cos(theta) * rad,
      Math.sin(theta) * rad,
      height
    );
    const museum = Cesium.Matrix4.multiplyByPoint(
      enu,
      local,
      new Cesium.Cartesian3()
    );

    const disc = {
      home,
      museum,
      u: a.atlas.u,
      v: a.atlas.v,
      index: i,
      ord: 0, // filled in below once all distances are known
    };
    groups[a.atlas.atlas_index].push(disc);
    flat.push({ disc, dist: Cesium.Cartesian3.distance(home, anchor) });
  });

  // Flight order: nearest origins leave the pile first, so the swarm ripples
  // outward. ord is normalised to [0,1]; the shader staggers each flight by it.
  flat.sort((p, q) => p.dist - q.dist);
  const last = Math.max(flat.length - 1, 1);
  flat.forEach((p, rank) => {
    p.disc.ord = rank / last;
  });

  return groups;
}

export { MUSEUM };
