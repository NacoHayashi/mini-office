// Skips drawing a frame when nothing on screen changed since the last frame drawn,
// and redraws the sun's shadows only when something that casts one moved.
// Characters breathe all the time, so a character part only counts as moved
// once some point of it could have drifted half a pixel since the last frame
// drawn; everything else counts at the smallest change.

const MAX_DRIFT_PX = 0.5;
// Draw at least this often anyway, in case something changed that is not tracked here.
const HEARTBEAT_MS = 1000;
// Matrix entries kept per object (the bottom row is always 0 0 0 1).
const POSE = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];

export function createRedraw(ctx) {
  const { actorGroup, camera, look, outlineWidth, renderer, scene, sun } = ctx;
  let last = new Float64Array(8192);
  let next = new Float64Array(8192);
  let lastLength = -1;
  let size = 0;
  let any = false;
  let shadow = false;
  let forced = true;
  let drawnAt = 0;

  function room(count) {
    if (size + count <= next.length) return;
    const grown = new Float64Array(Math.max(next.length * 2, size + count));
    grown.set(next);
    next = grown;
  }

  // Compare next[from..to) with what was there in the last frame drawn.
  function check(from, to, casts) {
    if (any && (!casts || shadow)) return;
    if (to > lastLength) {
      changed(casts);
      return;
    }
    for (let i = from; i < to; i++) {
      if (next[i] !== last[i]) {
        changed(casts);
        return;
      }
    }
  }

  function changed(casts) {
    any = true;
    if (casts) shadow = true;
  }

  // Values are written straight into the buffer: passing them through a
  // function call would box each number and allocate every frame.
  function put(value, casts) {
    room(1);
    next[size] = value;
    size += 1;
    check(size - 1, size, casts);
  }

  function putColor(color, at) {
    next[at] = color ? color.r : -1;
    next[at + 1] = color ? color.g : -1;
    next[at + 2] = color ? color.b : -1;
  }

  // Shadow-relevant fields first, then the ones only the screen sees.
  function putMaterial(material, casts) {
    room(16);
    const at = size;
    next[at] = material.id;
    next[at + 1] = material.version;
    next[at + 2] = (material.visible ? 1 : 0) + (material.transparent ? 2 : 0) + (material.depthWrite ? 4 : 0) + material.side * 8;
    next[at + 3] = material.opacity;
    putColor(material.color, at + 4);
    putColor(material.emissive, at + 7);
    next[at + 10] = material.emissiveIntensity ?? 0;
    const map = material.map;
    next[at + 11] = map ? map.id : -1;
    next[at + 12] = map ? map.version : -1;
    size = at + 13;
    check(at, at + 3, casts);
    check(at + 3, size, false);
  }

  function putMatrix(elements, casts) {
    room(POSE.length);
    const at = size;
    for (let i = 0; i < POSE.length; i++) next[at + i] = elements[POSE[i]];
    size = at + POSE.length;
    check(at, size, casts);
  }

  // A character part: moved once its matrix change could shift any point of
  // its geometry (within `reach` of its origin) by more than `budget`.
  function putPose(elements, budget, reach, casts) {
    room(POSE.length);
    const at = size;
    for (let i = 0; i < POSE.length; i++) next[at + i] = elements[POSE[i]];
    size += POSE.length;
    if (any && (!casts || shadow)) return;
    if (at + POSE.length > lastLength) {
      changed(casts);
      return;
    }
    let turn = 0;
    for (let col = 0; col < 3; col++) {
      const dx = next[at + col * 3] - last[at + col * 3];
      const dy = next[at + col * 3 + 1] - last[at + col * 3 + 1];
      const dz = next[at + col * 3 + 2] - last[at + col * 3 + 2];
      turn += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const mx = next[at + 9] - last[at + 9];
    const my = next[at + 10] - last[at + 10];
    const mz = next[at + 11] - last[at + 11];
    if (Math.sqrt(mx * mx + my * my + mz * mz) + turn * reach > budget) changed(casts);
  }

  function partReach(geometry) {
    if (!geometry) return 1;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    return sphere.center.length() + sphere.radius;
  }

  function walk(node, budget) {
    if (!node.visible) return;
    if (node === actorGroup) {
      // Half a pixel, measured at half the distance to the camera's target
      // (no character stands nearer than that).
      const height = renderer.domElement.height || 1;
      const reach = Math.max(1, camera.position.distanceTo(look) * 0.5);
      budget = (MAX_DRIFT_PX * 2 * reach * Math.tan((camera.fov * Math.PI) / 360)) / height;
    }
    if (node.isMesh || node.isSprite || node.isLine || node.isPoints) {
      const casts = node.castShadow === true;
      room(3);
      const at = size;
      next[at] = node.id;
      next[at + 1] = (casts ? 1 : 0) + (node.receiveShadow ? 2 : 0) + node.renderOrder * 4;
      next[at + 2] = node.geometry ? node.geometry.id : -1;
      size = at + 3;
      check(at, size, true);
      if (budget > 0) putPose(node.matrixWorld.elements, budget, partReach(node.geometry), casts);
      else putMatrix(node.matrixWorld.elements, casts);
      const material = node.material;
      if (Array.isArray(material)) {
        put(material.length, casts);
        for (let i = 0; i < material.length; i++) putMaterial(material[i], casts);
      } else if (material) putMaterial(material, casts);
    }
    if (node.isLight) {
      room(5);
      const at = size;
      next[at] = node.id;
      next[at + 1] = node.intensity;
      putColor(node.color, at + 2);
      size = at + 5;
      check(at, at + 1, true);
      check(at + 1, size, false);
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) walk(children[i], budget);
  }

  function measure() {
    size = 0;
    any = false;
    shadow = false;
    scene.updateMatrixWorld();
    walk(scene, 0);
    // The sun follows the camera target, so its shadow box moves with it.
    putMatrix(sun.matrixWorld.elements, true);
    putMatrix(sun.target.matrixWorld.elements, true);
    const shade = sun.shadow;
    room(7);
    let at = size;
    next[at] = shade.camera.left;
    next[at + 1] = shade.camera.right;
    next[at + 2] = shade.camera.top;
    next[at + 3] = shade.camera.bottom;
    next[at + 4] = shade.bias;
    next[at + 5] = shade.normalBias;
    next[at + 6] = shade.mapSize.x;
    size = at + 7;
    check(at, size, true);
    putMatrix(camera.matrixWorld.elements, false);
    putMatrix(camera.projectionMatrix.elements, false);
    room(7);
    at = size;
    putColor(scene.background?.isColor ? scene.background : null, at);
    next[at + 3] = scene.fog ? scene.fog.near : 0;
    next[at + 4] = scene.fog ? scene.fog.far : 0;
    next[at + 5] = outlineWidth();
    next[at + 6] = renderer.getPixelRatio();
    size = at + 7;
    check(at, size, false);
  }

  /** Whether this frame should be drawn; call once per frame after the scene is posed. */
  function due(now) {
    measure();
    if (lastLength !== size) any = shadow = true;
    if (forced || now - drawnAt >= HEARTBEAT_MS) any = shadow = true;
    if (!any) return false;
    if (shadow) renderer.shadowMap.needsUpdate = true;
    const swap = last;
    last = next;
    next = swap.length < last.length ? new Float64Array(last.length) : swap;
    lastLength = size;
    forced = false;
    drawnAt = now;
    return true;
  }

  /** Draw the next frame whatever happens (resize, new effects, ...). */
  function force() {
    forced = true;
  }

  return { due, force };
}
