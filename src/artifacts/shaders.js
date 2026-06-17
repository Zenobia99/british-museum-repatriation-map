// GLSL for the photo-disc primitive. Cesium 1.142 is WebGL2-only and compiles
// shaders as GLSL ES 3.00, so these use `in`/`out`, `texture()`, and Cesium's
// auto-declared `out_FragColor` (NOT attribute/varying/gl_FragColor/texture2D).
// Cesium prepends the #version directive and wires up the czm_* automatic
// uniforms it detects.
//
// Each disc is a camera-facing quad sized in screen pixels. The vertex shader
// flies each disc from its museum pile slot to its home origin along a
// great-circle arc, staggered per object so the swarm streams out over time.
//
//   u_prog : overall run progress, 0 (all piled) -> 1 (all home)
//   aOrd   : this disc's normalised flight order [0,1]
//   S      : stagger spread — each disc flies for 1/(1+S) of the run
//
//   t = clamp(u_prog*(1+S) - aOrd*S, 0, 1)   is this disc's own 0->1 flight.

export const DISC_VERTEX = /* glsl */ `
in vec3 aHome;     // ECEF position at the origin country
in vec3 aMuseum;   // ECEF position in the Bloomsbury pile
in float aOrd;     // flight order by distance [0,1]
in float aOrdTake; // flight order by acquisition year [0,1]
in vec2 aCorner;   // quad corner in [-1, 1]
in vec2 aUv;       // atlas UV at this corner

uniform float u_prog;     // 0 = piled, 1 = home
uniform float u_pxSize;   // disc radius in pixels
uniform float u_reverse;  // 0 = museum->home, 1 = home->museum
uniform float u_aspect;   // x-axis size correction (1.0 = none)
uniform float u_useTake;  // 0 = order by distance, 1 = order by acquisition year

out vec2 v_uv;
out vec2 v_local;
out float v_flight;   // 1 while airborne, for the fragment warm-up

const float PI = 3.14159265;
const float S = 6.0;            // stagger spread
const float LIFT_BASE = 1.8e5;  // metres of arc apex for a short hop
const float LIFT_SPAN = 1.9e6;  // extra apex metres for a half-globe arc

// Great-circle interpolation between two ECEF points, with an altitude bump
// (apex) that grows with the angular span of the arc.
vec3 arcPoint(vec3 p0, vec3 p1, float t) {
  float r0 = length(p0), r1 = length(p1);
  vec3 a = p0 / r0, b = p1 / r1;
  float c = clamp(dot(a, b), -1.0, 1.0);
  float ang = acos(c);
  vec3 dir;
  if (ang < 1e-3) {
    dir = normalize(mix(a, b, t));
  } else {
    dir = (sin((1.0 - t) * ang) * a + sin(t * ang) * b) / sin(ang);
  }
  float lift = (LIFT_BASE + LIFT_SPAN * (ang / PI)) * sin(PI * t);
  return dir * (mix(r0, r1, t) + lift);
}

void main() {
  float ord = mix(aOrd, aOrdTake, u_useTake);
  float t = clamp(u_prog * (1.0 + S) - ord * S, 0.0, 1.0);

  vec3 from = mix(aMuseum, aHome, u_reverse);
  vec3 to   = mix(aHome, aMuseum, u_reverse);
  vec3 worldPos = arcPoint(from, to, t);

  v_flight = step(0.0001, t) * step(t, 0.9999);

  vec4 clip = czm_modelViewProjection * vec4(worldPos, 1.0);

  // Offset the corner in screen space so the quad always faces the camera and
  // keeps a constant pixel size regardless of distance. u_aspect corrects any
  // residual x/y stretch so the discs render as true circles.
  vec2 ndcPerPx = 2.0 / czm_viewport.zw;
  vec2 off = aCorner * u_pxSize * ndcPerPx;
  off.x *= u_aspect;
  clip.xy += off * clip.w;

  gl_Position = clip;
  v_uv = aUv;
  v_local = aCorner;
}
`;

export const DISC_FRAGMENT = /* glsl */ `
uniform sampler2D u_atlas;
uniform float u_opacity;  // global fade (1 = opaque)

in vec2 v_uv;
in vec2 v_local;
in float v_flight;

void main() {
  float r = length(v_local);

  // Resolution-independent anti-aliased circular edge: fade the alpha across
  // roughly one pixel of the rim using screen-space derivatives, instead of a
  // hard discard (which stair-steps). Smooth at any disc size.
  float aa = fwidth(r);
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  if (mask <= 0.0) discard;

  vec4 tex = texture(u_atlas, v_uv);
  float a = tex.a * mask * u_opacity;
  if (a < 0.004) discard;

  // Warm the disc slightly while it is airborne.
  vec3 col = tex.rgb + v_flight * vec3(0.16, 0.10, 0.03);
  out_FragColor = vec4(col, a);
}
`;
