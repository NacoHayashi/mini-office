// Shared toon materials, cached geometry, and small mesh helpers for the office scene.
import * as THREE from "./vendor/three.module.js";

// Changed copies of a material (a tint, a lit screen, a fade) are shared by
// every mesh that asks for the same change, instead of one copy per mesh.
const variants = new Map();
const rootOf = new WeakMap();
const fades = new WeakMap();
const solids = new WeakMap();

function variant(base, key, apply) {
  const id = `${base.uuid}|${key}`;
  let material = variants.get(id);
  if (!material) {
    material = base.clone();
    apply(material);
    rootOf.set(material, base);
    variants.set(id, material);
  }
  return material;
}

function fadedOf(material) {
  if (solids.has(material)) return material;
  let faded = fades.get(material);
  if (!faded) {
    faded = material.clone();
    faded.transparent = true;
    faded.depthWrite = false;
    faded.opacity = 0.13 * material.opacity;
    fades.set(material, faded);
    solids.set(faded, material);
  }
  return faded;
}

function solidOf(material) {
  return solids.get(material) || material;
}

/**
 * Restyle a mesh's materials: each slot whose original material passes `pick`
 * gets the shared copy of it changed by `apply`, and `key` names that change
 * (same key, same copy). A faded mesh stays faded.
 */
export function restyle(node, key, apply, pick = () => true) {
  const swap = (material) => {
    if (!material) return material;
    const solid = solidOf(material);
    const root = rootOf.get(solid) || solid;
    if (!pick(root)) return material;
    const next = variant(root, key, apply);
    return node.userData.faded ? fadedOf(next) : next;
  };
  node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
}

export function createMaterials(ctx) {
  const { blobTexture, gradient, renderer, skinGradient } = ctx;

  const mats = new Map();
  const geos = new Map();

  function mat(color, extra = {}) {
    const key = `${color}|${extra.basic ? 1 : 0}|${extra.clay ? 1 : 0}|${extra.skin ? 1 : 0}|${extra.transparent ? 1 : 0}|${extra.opacity ?? 1}|${extra.emissive || 0}|${extra.vertexColors ? 1 : 0}|${extra.mapName || ""}|${extra.side || 0}|${extra.roughness ?? ""}|${extra.metalness ?? ""}`;
    let material = mats.get(key);
    if (material) return material;
    if (extra.skin) {
      material = new THREE.MeshToonMaterial({ color, gradientMap: skinGradient, vertexColors: Boolean(extra.vertexColors) });
    } else if (extra.clay) {
      material = new THREE.MeshStandardMaterial({
        color,
        map: extra.map || null,
        roughness: extra.roughness ?? 0.92,
        metalness: extra.metalness ?? 0,
        envMapIntensity: extra.env ?? 0.4,
        emissive: extra.emissive || 0x000000,
        emissiveIntensity: extra.emissive ? (extra.emissiveIntensity ?? 0.4) : 0,
        vertexColors: Boolean(extra.vertexColors),
        transparent: Boolean(extra.transparent),
        opacity: extra.opacity ?? 1,
        depthWrite: extra.depthWrite !== false,
        side: extra.side || THREE.FrontSide,
      });
    } else if (extra.basic) {
      material = new THREE.MeshBasicMaterial({
        color,
        map: extra.map || null,
        transparent: Boolean(extra.transparent),
        opacity: extra.opacity ?? 1,
        depthWrite: extra.depthWrite !== false,
        side: extra.side || THREE.FrontSide,
        vertexColors: Boolean(extra.vertexColors),
      });
    } else {
      material = new THREE.MeshToonMaterial({
        color,
        map: extra.map || null,
        gradientMap: gradient,
        emissive: extra.emissive || 0x000000,
        emissiveIntensity: extra.emissive ? 0.45 : 0,
        vertexColors: Boolean(extra.vertexColors),
        transparent: Boolean(extra.transparent),
        opacity: extra.opacity ?? 1,
        side: extra.side || THREE.FrontSide,
      });
    }
    mats.set(key, material);
    return material;
  }

  function geo(key, build) {
    let value = geos.get(key);
    if (!value) {
      value = build();
      geos.set(key, value);
    }
    return value;
  }

  function smoothSphere(radius, width = 36, height = 28) {
    return geo(`ss|${radius}|${width}|${height}`, () => new THREE.SphereGeometry(radius, width, height));
  }

  function roundedBox(w, h, d, radius = 4) {
    const r = Math.max(0.4, Math.min(radius, w / 2 - 0.2, d / 2 - 0.2, h / 2));
    return geo(`rb|${w}|${h}|${d}|${r}`, () => {
      const shape = new THREE.Shape();
      const x = -w / 2;
      const z = -d / 2;
      shape.moveTo(x + r, z);
      shape.lineTo(x + w - r, z);
      shape.quadraticCurveTo(x + w, z, x + w, z + r);
      shape.lineTo(x + w, z + d - r);
      shape.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
      shape.lineTo(x + r, z + d);
      shape.quadraticCurveTo(x, z + d, x, z + d - r);
      shape.lineTo(x, z + r);
      shape.quadraticCurveTo(x, z, x + r, z);
      const extruded = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 2 });
      extruded.translate(0, 0, -h / 2);
      extruded.rotateX(-Math.PI / 2);
      return extruded;
    });
  }

  // Fading swaps in a shared see-through copy of the mesh's material, made the
  // first time any mesh with that material fades, and swaps back afterwards.
  function setFade(object, faded) {
    // Most occluders stay solid every frame; skip their subtree once it is known solid.
    if (!faded && object.userData.solidTree) return;
    object.userData.solidTree = !faded;
    object.traverse((node) => {
      if (!node.isMesh || Boolean(node.userData.faded) === faded) return;
      node.userData.faded = faded;
      // Outline materials are shared, so hide the edge instead of fading it.
      if (node.userData.outline) {
        node.visible = !faded;
        return;
      }
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => (faded ? fadedOf(material) : solidOf(material)))
        : faded ? fadedOf(node.material) : solidOf(node.material);
    });
  }

  function contactShadow(parent, rx, rz) {
    const mesh = new THREE.Mesh(
      geo(`blob|${rx}|${rz}`, () => new THREE.CircleGeometry(1, 18)),
      mat(0x5a4f66, { basic: true, transparent: true, opacity: 0.22, depthWrite: false, map: blobTexture, mapName: "shadow" }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(rx * 1.15, rz * 1.15, 1);
    mesh.position.y = 0.45;
    parent.add(mesh);
    return mesh;
  }

  function rugMesh(width, depth, tint) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, 108, 108);
    ctx.strokeStyle = "rgba(120,70,80,0.25)";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, 88, 88);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  function addMesh(parent, geometry, material, x, y, z, opts = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = Boolean(opts.cast);
    mesh.receiveShadow = opts.receive !== false;
    if (opts.sx || opts.sy || opts.sz) mesh.scale.set(opts.sx || 1, opts.sy || 1, opts.sz || 1);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    if (opts.rotX) mesh.rotation.x = opts.rotX;
    if (opts.rotZ) mesh.rotation.z = opts.rotZ;
    parent.add(mesh);
    return mesh;
  }

  function patternTexture(kind) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (kind === "plain") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "rgba(96, 90, 86, 0.045)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 64.5);
      ctx.lineTo(128, 64.5);
      ctx.moveTo(64.5, 0);
      ctx.lineTo(64.5, 128);
      ctx.stroke();
    } else if (kind === "tile") {
      ctx.fillStyle = "#e7f3f0";
      ctx.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          ctx.fillStyle = (x + y) % 2 ? "rgba(255,255,255,0.45)" : "rgba(150, 180, 176, 0.18)";
          ctx.fillRect(x * 64 + 4, y * 64 + 4, 56, 56);
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = 3;
          ctx.strokeRect(x * 64 + 4, y * 64 + 4, 56, 56);
        }
      }
    } else {
      ctx.fillStyle = "#efe4f2";
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 36; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.05 + (i % 4) * 0.03})`;
        ctx.beginPath();
        ctx.arc((i * 41) % 128, (i * 29) % 128, 5 + (i % 5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  return {
    addMesh,
    contactShadow,
    geo,
    mat,
    mats,
    patternTexture,
    roundedBox,
    rugMesh,
    setFade,
    smoothSphere,
  };
}
