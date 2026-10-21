import * as THREE from "./vendor/three.module.js";

// Few-step light ramps for MeshToonMaterial. Nearest filtering keeps the
// steps crisp instead of blending them back into a smooth gradient.
export function stepGradient(levels) {
  const texture = new THREE.DataTexture(new Uint8Array(levels), levels.length, 1, THREE.RedFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Same hue as the surface, just deeper, so the edge reads as a soft line
// rather than a black cartoon frame.
export function edgeColor(hex, depth = 0.6, chroma = 0.7) {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl, THREE.SRGBColorSpace);
  // Cap saturation first: pale bodies sit at high HSL saturation, and only
  // darkening them would turn a cream rabbit's edge bright orange.
  color.setHSL(hsl.h, Math.min(hsl.s, 0.5) * chroma, hsl.l * depth, THREE.SRGBColorSpace);
  return color.getHex();
}

const width = { value: 1 };
const materials = new Map();
const shells = new WeakMap();

export function setOutlineWidth(value) {
  width.value = value;
}

// Inverted hull: back faces pushed out along the normal in view space. The
// push grows with depth, so the line stays about the same width on screen in
// both the overhead and the follow camera.
export function outlineMaterial(color) {
  let material = materials.get(color);
  if (material) return material;
  material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = width;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float outlineWidth;")
      .replace(
        "#include <project_vertex>",
        [
          "vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );",
          "mvPosition.xyz += normalize( normalMatrix * normal ) * outlineWidth * 0.0021 * max( 60.0, -mvPosition.z );",
          "gl_Position = projectionMatrix * mvPosition;",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "toon-outline";
  materials.set(color, material);
  return material;
}

// Hard-edged meshes split their normals at corners, which would tear the
// pushed-out hull apart. Average normals that share a position instead.
function shellGeometry(geometry) {
  let shell = shells.get(geometry);
  if (shell) return shell;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const sums = new Map();
  const keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 200)}|${Math.round(pos.getY(i) * 200)}|${Math.round(pos.getZ(i) * 200)}`;
    keys[i] = key;
    const sum = sums.get(key) || [0, 0, 0];
    sum[0] += normal.getX(i);
    sum[1] += normal.getY(i);
    sum[2] += normal.getZ(i);
    sums.set(key, sum);
  }
  const smooth = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = sums.get(keys[i]);
    const len = Math.hypot(x, y, z) || 1;
    smooth[i * 3] = x / len;
    smooth[i * 3 + 1] = y / len;
    smooth[i * 3 + 2] = z / len;
  }
  shell = new THREE.BufferGeometry();
  shell.setAttribute("position", pos);
  shell.setAttribute("normal", new THREE.Float32BufferAttribute(smooth, 3));
  if (geometry.index) shell.setIndex(geometry.index);
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  shell.boundingSphere = geometry.boundingSphere.clone();
  shell.boundingSphere.radius += 2;
  shells.set(geometry, shell);
  return shell;
}

export function addOutline(mesh, color) {
  const shell = new THREE.Mesh(shellGeometry(mesh.geometry), outlineMaterial(color));
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.frustumCulled = mesh.frustumCulled;
  shell.userData.outline = true;
  shell.userData.owned = true;
  shell.raycast = () => {};
  mesh.add(shell);
  return shell;
}
