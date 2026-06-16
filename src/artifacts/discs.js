import * as Cesium from 'cesium';
import { ATLAS } from './data.js';
import { DISC_VERTEX, DISC_FRAGMENT } from './shaders.js';

const ATTRIBUTE_LOCATIONS = { aHome: 0, aMuseum: 1, aCorner: 2, aUv: 3, aOrd: 4 };

// Quad corners (screen-space, [-1,1]) and the matching fraction of the atlas
// tile to sample. Photos read upright: corner.y = +1 is the top of the disc
// and maps to the top of the tile (texture v measured downward from the top,
// which is why the texture is uploaded with flipY = false).
const CORNERS = [
  [-1, -1], // bottom-left
  [1, -1], // bottom-right
  [1, 1], // top-right
  [-1, 1], // top-left
];
const CORNER_UV = [
  [0, 1], // -> (u,        v + tile)
  [1, 1], // -> (u + tile, v + tile)
  [1, 0], // -> (u + tile, v)
  [0, 0], // -> (u,        v)
];

// One draw call per atlas sheet: builds a VertexArray of camera-facing quads,
// binds that sheet's texture, and renders in the translucent pass.
class SheetBatch {
  constructor(group, getProg, getPxSize, getReverse) {
    this.group = group;
    this._getProg = getProg;
    this._getPxSize = getPxSize;
    this._getReverse = getReverse;
    this._va = null;
    this._sp = null;
    this._rs = null;
    this._command = null;
    this._texture = null;
    this._indexCount = group.length * 6;
    this._boundingVolume = new Cesium.BoundingSphere(
      Cesium.Cartesian3.ZERO,
      6.6e6 // covers the whole globe; discs roam everywhere
    );
  }

  setTexture(texture) {
    this._texture = texture;
  }

  _buildVertexArray(context) {
    const n = this.group.length;
    const home = new Float32Array(n * 4 * 3);
    const museum = new Float32Array(n * 4 * 3);
    const corner = new Float32Array(n * 4 * 2);
    const uv = new Float32Array(n * 4 * 2);
    const ord = new Float32Array(n * 4);
    const indices = new Uint16Array(n * 6);
    const ts = ATLAS.tileScale;

    for (let i = 0; i < n; i++) {
      const d = this.group[i];
      const base = i * 4;
      for (let k = 0; k < 4; k++) {
        const vi = base + k;
        home[vi * 3] = d.home.x;
        home[vi * 3 + 1] = d.home.y;
        home[vi * 3 + 2] = d.home.z;
        museum[vi * 3] = d.museum.x;
        museum[vi * 3 + 1] = d.museum.y;
        museum[vi * 3 + 2] = d.museum.z;
        corner[vi * 2] = CORNERS[k][0];
        corner[vi * 2 + 1] = CORNERS[k][1];
        uv[vi * 2] = d.u + CORNER_UV[k][0] * ts;
        uv[vi * 2 + 1] = d.v + CORNER_UV[k][1] * ts;
        ord[vi] = d.ord;
      }
      const o = i * 6;
      indices[o] = base;
      indices[o + 1] = base + 1;
      indices[o + 2] = base + 2;
      indices[o + 3] = base;
      indices[o + 4] = base + 2;
      indices[o + 5] = base + 3;
    }

    const FLOAT = Cesium.ComponentDatatype.FLOAT;
    const usage = Cesium.BufferUsage.STATIC_DRAW;
    const vb = (typedArray) =>
      Cesium.Buffer.createVertexBuffer({ context, typedArray, usage });

    const indexBuffer = Cesium.Buffer.createIndexBuffer({
      context,
      typedArray: indices,
      usage,
      indexDatatype: Cesium.IndexDatatype.UNSIGNED_SHORT,
    });

    this._va = new Cesium.VertexArray({
      context,
      attributes: [
        { index: 0, vertexBuffer: vb(home), componentsPerAttribute: 3, componentDatatype: FLOAT },
        { index: 1, vertexBuffer: vb(museum), componentsPerAttribute: 3, componentDatatype: FLOAT },
        { index: 2, vertexBuffer: vb(corner), componentsPerAttribute: 2, componentDatatype: FLOAT },
        { index: 3, vertexBuffer: vb(uv), componentsPerAttribute: 2, componentDatatype: FLOAT },
        { index: 4, vertexBuffer: vb(ord), componentsPerAttribute: 1, componentDatatype: FLOAT },
      ],
      indexBuffer,
    });
  }

  update(frameState) {
    if (!this._texture) return; // texture still loading
    const context = frameState.context;

    if (!this._va) this._buildVertexArray(context);

    if (!this._sp) {
      this._sp = Cesium.ShaderProgram.fromCache({
        context,
        vertexShaderSource: DISC_VERTEX,
        fragmentShaderSource: DISC_FRAGMENT,
        attributeLocations: ATTRIBUTE_LOCATIONS,
      });
    }

    if (!this._rs) {
      this._rs = Cesium.RenderState.fromCache({
        depthTest: { enabled: true },
        depthMask: false, // translucent — tested against the opaque globe
        blending: Cesium.BlendingState.ALPHA_BLEND,
        cull: { enabled: false },
      });
    }

    if (!this._command) {
      const self = this;
      this._command = new Cesium.DrawCommand({
        owner: this,
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        vertexArray: this._va,
        shaderProgram: this._sp,
        renderState: this._rs,
        pass: Cesium.Pass.TRANSLUCENT,
        modelMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY),
        boundingVolume: this._boundingVolume,
        count: this._indexCount,
        uniformMap: {
          u_prog: () => self._getProg(),
          u_pxSize: () => self._getPxSize(),
          u_reverse: () => self._getReverse(),
          u_atlas: () => self._texture,
        },
      });
    }

    frameState.commandList.push(this._command);
  }

  isDestroyed() {
    return false;
  }

  destroy() {
    if (this._va) this._va = this._va.destroy();
    if (this._sp) this._sp = this._sp.destroy();
    if (this._texture) this._texture = this._texture.destroy();
    return Cesium.destroyObject(this);
  }
}

// The collection primitive: holds one SheetBatch per atlas sheet, exposes the
// shared `time` (0 = pile, 1 = home) and `pxSize` controls, and loads the
// atlas textures asynchronously.
export class PhotoDiscs {
  constructor(scene, groups) {
    this.prog = 1.0; // 0 = piled at the museum, 1 = home. Starts home.
    this.reverse = 0.0; // 0 = museum->home, 1 = home->museum
    this.pxSize = 11.0; // disc radius in pixels
    this._batches = groups.map(
      (g) =>
        new SheetBatch(
          g,
          () => this.prog,
          () => this.pxSize,
          () => this.reverse
        )
    );
    this._loadTextures(scene.context);
  }

  async _loadTextures(context) {
    await Promise.all(
      this._batches.map(async (batch, i) => {
        if (batch.group.length === 0) return;
        try {
          const image = await Cesium.Resource.fetchImage({
            url: ATLAS.sheetUrl(i),
          });
          const texture = new Cesium.Texture({
            context,
            source: image,
            flipY: false,
            sampler: new Cesium.Sampler({
              minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
              magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
              wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
              wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
            }),
          });
          batch.setTexture(texture);
        } catch (err) {
          console.error(`[discs] atlas sheet ${i} failed to load:`, err);
        }
      })
    );
  }

  update(frameState) {
    if (!frameState.passes.render) return;
    for (const batch of this._batches) batch.update(frameState);
  }

  isDestroyed() {
    return false;
  }

  destroy() {
    for (const batch of this._batches) batch.destroy();
    return Cesium.destroyObject(this);
  }
}

// Convenience: build positions, create the primitive, add it to the scene.
export function addPhotoDiscs(viewer, groups) {
  const discs = new PhotoDiscs(viewer.scene, groups);
  viewer.scene.primitives.add(discs);
  return discs;
}
