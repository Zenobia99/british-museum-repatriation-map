import * as Cesium from 'cesium';

// The high-quality British Museum model, geo-placed at Bloomsbury. These
// values are the calibrated transform carried over from the model-alignment
// sandbox (scale/heading/height tuned by hand against the satellite imagery).
export const MUSEUM = {
  lat: 51.51965,
  lon: -0.12718,
  heightOffset: -10, // metres, relative to ground
  heading: 55, // degrees
  scale: 85.9,
  modelUrl: `${import.meta.env.BASE_URL}models/british-museum.glb`,
};

// The opening "hero" framing — a NW-facing low-angle look at the columns and
// entrance, also carried over from the alignment sandbox.
export const HERO_VIEW = {
  destination: Cesium.Cartesian3.fromDegrees(
    -0.11998240713621232,
    51.51715855900223,
    349.62060273944223
  ),
  orientation: {
    heading: Cesium.Math.toRadians(305.0),
    pitch: Cesium.Math.toRadians(-30.0),
    roll: Cesium.Math.toRadians(0.0),
  },
};

let museumEntity = null;

// Place (or replace) the museum model. Returns the created entity.
export async function addMuseum(viewer) {
  if (museumEntity) {
    viewer.entities.remove(museumEntity);
    museumEntity = null;
  }

  const position = Cesium.Cartesian3.fromDegrees(
    MUSEUM.lon,
    MUSEUM.lat,
    MUSEUM.heightOffset
  );
  const hpr = new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians(MUSEUM.heading),
    0,
    0
  );
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

  museumEntity = viewer.entities.add({
    name: 'The British Museum',
    position,
    orientation,
    model: {
      uri: MUSEUM.modelUrl,
      scale: MUSEUM.scale,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
    },
  });

  return museumEntity;
}

export function getMuseumEntity() {
  return museumEntity;
}

// The fixed geographic anchor of the museum (where the artefact pile sits).
export function museumAnchor() {
  return Cesium.Cartesian3.fromDegrees(MUSEUM.lon, MUSEUM.lat, MUSEUM.heightOffset);
}

export function flyToHeroView(viewer, animate = true) {
  if (animate) {
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({
      ...HERO_VIEW,
      duration: 3.0,
      complete: () => enableControls(viewer),
      cancel: () => enableControls(viewer),
    });
  } else {
    viewer.camera.setView(HERO_VIEW);
  }
}

// A comfortable oblique view that frames the museum from ~1.5 km up. Using
// flyToBoundingSphere (rather than a hard-coded near-ground pose) keeps the
// camera high enough that the normal orbit/zoom globe controls apply — so the
// opening and closing feel the same as exploring the globe, and the camera
// can't end up under the terrain.
const MUSEUM_FRAME = { heading: 35, pitch: -34, range: 1900 };

export function flyToMuseum(viewer, animate = true) {
  const center = Cesium.Cartesian3.fromDegrees(MUSEUM.lon, MUSEUM.lat, 30);
  const sphere = new Cesium.BoundingSphere(center, 220);
  viewer.camera.cancelFlight();
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(MUSEUM_FRAME.heading),
      Cesium.Math.toRadians(MUSEUM_FRAME.pitch),
      MUSEUM_FRAME.range
    ),
    duration: animate ? 3.0 : 0,
    complete: () => enableControls(viewer),
    cancel: () => enableControls(viewer),
  });
}

// Cesium's flyTo disables camera input during a flight and restores it on
// completion; overlapping flights can leave it stuck off. Always force input
// back on when a flight ends so the final frame is controllable.
function enableControls(viewer) {
  viewer.scene.screenSpaceCameraController.enableInputs = true;
}

// Street-level framing of the entrance, in east-north-up metres around the
// museum's ground point. The camera sits SE of the building (the columned
// front faces SE) at street height and looks back at the entrance. These are
// a starting guess — drag to the perfect spot in the browser and run
// `logCam()` in the console to capture exact values, then we bake them in.
export const ENTRANCE = {
  camEast: 120, // metres east of centre
  camNorth: -110, // metres south of centre
  camUp: 16, // camera height (street level)
  lookUp: 22, // height of the point we aim at on the facade
};

export function flyToEntrance(viewer, duration = 4.5) {
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const ground = Cesium.Cartesian3.fromDegrees(MUSEUM.lon, MUSEUM.lat, 0);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(ground);

  const camPos = Cesium.Matrix4.multiplyByPoint(
    enu,
    new Cesium.Cartesian3(ENTRANCE.camEast, ENTRANCE.camNorth, ENTRANCE.camUp),
    new Cesium.Cartesian3()
  );
  const target = Cesium.Matrix4.multiplyByPoint(
    enu,
    new Cesium.Cartesian3(0, 0, ENTRANCE.lookUp),
    new Cesium.Cartesian3()
  );

  const direction = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(target, camPos, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  const up = ellipsoid.geodeticSurfaceNormal(camPos, new Cesium.Cartesian3());

  viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: camPos,
    orientation: { direction, up },
    duration,
    complete: () => enableControls(viewer),
    cancel: () => enableControls(viewer),
  });
}

// Console helper: prints the current camera pose in a copy-paste friendly form
// so a hand-framed view can be baked into ENTRANCE_VIEW / HERO_VIEW.
export function logCam(viewer) {
  const c = viewer.camera;
  const carto = c.positionCartographic;
  console.log(
    'destination: Cesium.Cartesian3.fromDegrees(' +
      `${Cesium.Math.toDegrees(carto.longitude)}, ` +
      `${Cesium.Math.toDegrees(carto.latitude)}, ${carto.height})\n` +
      `heading: ${Cesium.Math.toDegrees(c.heading)}\n` +
      `pitch:   ${Cesium.Math.toDegrees(c.pitch)}\n` +
      `roll:    ${Cesium.Math.toDegrees(c.roll)}`
  );
}
