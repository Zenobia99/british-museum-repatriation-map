import * as Cesium from 'cesium';
import { feature } from 'topojson-client';

// Subtle country borders + name labels, drawn from the same Natural Earth
// 110m TopoJSON the original 2D map used. Borders are ground-clamped polylines
// (visible over terrain); labels sit at each country's largest-landmass
// centroid and fade in/out by distance so they don't clutter the globe.

const BORDER_COLOR = Cesium.Color.fromCssColorString('#5d6f80').withAlpha(0.38);

// Planar (lng/lat) ring area + centroid — fine for picking a label anchor.
function ringAreaAndCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    // Degenerate ring: fall back to the average vertex.
    const avg = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return { area: 0, centroid: [avg[0] / ring.length, avg[1] / ring.length] };
  }
  return { area: Math.abs(area), centroid: [cx / (6 * area), cy / (6 * area)] };
}

export async function addBordersAndLabels(viewer) {
  const url = `${import.meta.env.BASE_URL}data/countries-110m.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load countries-110m.json (${res.status})`);
  const topo = await res.json();
  const geo = feature(topo, topo.objects.countries); // FeatureCollection

  const ds = new Cesium.CustomDataSource('borders');

  for (const f of geo.features) {
    const name = f.properties && f.properties.name;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;

    let best = null;
    let bestArea = -1;

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
      // Label anchor: centroid of the country's largest ring.
      const { area, centroid } = ringAreaAndCentroid(poly[0]);
      if (area > bestArea) {
        bestArea = area;
        best = centroid;
      }
    }

    if (name && best) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(best[0], best[1]),
        label: {
          text: name,
          font: '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#f4f7fa'),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
          outlineWidth: 3.5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.35),
          backgroundPadding: new Cesium.Cartesian2(7, 4),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          // Stay legible across the whole pull-out range; only gently fade.
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2.6e7),
          translucencyByDistance: new Cesium.NearFarScalar(3.0e6, 1.0, 2.6e7, 0.45),
          scaleByDistance: new Cesium.NearFarScalar(3.0e6, 1.1, 2.0e7, 0.6),
        },
      });
    }
  }

  await viewer.dataSources.add(ds);
  return ds;
}
