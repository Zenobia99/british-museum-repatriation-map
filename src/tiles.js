import * as Cesium from 'cesium';

// Google Photorealistic 3D Tiles — real photogrammetry of London (and the
// whole planet) for a convincing street-level view. Two ways to authenticate:
//   1. A Google Maps Platform API key in VITE_GOOGLE_MAPS_API_KEY, or
//   2. The "Google Photorealistic 3D Tiles" asset (id 2275207) enabled in your
//      Cesium ion account (uses the existing ion token).
// When the tiles load we hide the default imagery globe (the tiles provide the
// surface), which also removes the draped-imagery smearing at low angles.
// Returns the tileset, or null if unavailable (caller keeps the imagery globe).
export async function addGoogleTiles(viewer) {
  const scene = viewer.scene;
  const gkey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  let tileset = null;
  try {
    if (gkey) {
      Cesium.GoogleMaps.defaultApiKey = gkey;
      tileset = await Cesium.createGooglePhotorealistic3DTileset();
    } else {
      // Google Photorealistic 3D Tiles via Cesium ion.
      tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
    }
    scene.primitives.add(tileset);
    // The tiles are the surface now — hide the globe to avoid z-fighting with
    // the draped imagery. Ground-clamped borders still drape over the tiles.
    scene.globe.show = false;
    return tileset;
  } catch (e) {
    console.warn(
      '[return-them-home] Google 3D Tiles unavailable — keeping the imagery ' +
        'globe. Add VITE_GOOGLE_MAPS_API_KEY, or enable asset 2275207 in your ' +
        'Cesium ion account.',
      e
    );
    return null;
  }
}
