import * as Cesium from 'cesium';

// The British Museum's location at Bloomsbury. The pile of artefacts is
// anchored here (the building itself comes from Google's photorealistic
// 3D tiles, so no separate model is loaded).
export const MUSEUM = {
  lat: 51.51965,
  lon: -0.12718,
};

// The fixed geographic anchor of the museum (where the artefact pile sits).
export function museumAnchor() {
  return Cesium.Cartesian3.fromDegrees(MUSEUM.lon, MUSEUM.lat, 0);
}

// The opening/closing framing — a hand-picked front-on view of the museum
// with the pile in the Great Court (captured via logCam). High enough that
// the normal orbit/zoom globe controls apply.
export const OPENING_VIEW = {
  destination: Cesium.Cartesian3.fromDegrees(
    -0.12427339830198514,
    51.517174368264655,
    175.76778338385463
  ),
  orientation: {
    heading: Cesium.Math.toRadians(329.0028),
    pitch: Cesium.Math.toRadians(-22.0035),
    roll: 0.0,
  },
};

export function flyToMuseum(viewer, animate = true) {
  viewer.camera.cancelFlight();
  if (animate) {
    viewer.camera.flyTo({
      ...OPENING_VIEW,
      duration: 3.0,
      complete: () => enableControls(viewer),
      cancel: () => enableControls(viewer),
    });
  } else {
    viewer.camera.setView(OPENING_VIEW);
  }
}

// Cesium's flyTo disables camera input during a flight and restores it on
// completion; overlapping flights can leave it stuck off. Always force input
// back on when a flight ends so the final frame is controllable.
function enableControls(viewer) {
  viewer.scene.screenSpaceCameraController.enableInputs = true;
}

// Console helper: prints the current camera pose in a copy-paste friendly form
// so a hand-framed view can be baked into OPENING_VIEW.
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
