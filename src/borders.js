import * as Cesium from 'cesium';
import { feature } from 'topojson-client';

// Subtle country borders drawn from the Natural Earth 110m TopoJSON, as
// ground-clamped polylines (visible over terrain). Country name labels are
// handled separately as clickable per-origin labels in explore.js.

const BORDER_COLOR = Cesium.Color.fromCssColorString('#5d6f80').withAlpha(0.38);

export async function addBorders(viewer) {
  const url = `${import.meta.env.BASE_URL}data/countries-110m.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load countries-110m.json (${res.status})`);
  const topo = await res.json();
  const geo = feature(topo, topo.objects.countries); // FeatureCollection

  const ds = new Cesium.CustomDataSource('borders');

  for (const f of geo.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;

    for (const poly of polys) {
      for (const ring of poly) {
        // Ground-clamped border polyline for every ring.
        const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
        ds.entities.add({
          polyline: {
            positions,
            width: 0.8,
            clampToGround: true,
            material: new Cesium.ColorMaterialProperty(BORDER_COLOR),
          },
        });
      }
    }
  }

  await viewer.dataSources.add(ds);
  return ds;
}
