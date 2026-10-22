import * as THREE from "./vendor/three.module.js";
import { createLibrary } from "./furnish.js";
import { lalaHeading } from "./lala.js";
import { setOutlineWidth, stepGradient } from "./toon.js";
import { CREATURE, SHADOW_Y, createAvatars, cssColor } from "./avatar.js";

const TILE = 32;
const WALL_H = 36;
const WALL_T = 12;
const ISO_PITCH = 0.78;
const FOLLOW_PITCH = Math.PI / 2 - (30 * Math.PI) / 180;
const FALLBACK_LOOK = {
  v: 2,
  body: "mochi",
  ears: "point",
  tail: "none",
  eyes: "dot",
  mouth: "smile",
  blush: "oval",
  marking: "none",
  head: "none",
  face: "none",
  neck: "none",
  held: "none",
  colors: {
    body: "#f7c6d4",
    ear: "#f7c6d4",
    inner: "#f4a0b5",
    tip: "#e8899f",
    tail: "#f7c6d4",
    blush: "#f4a0b5",
    accessory: "#f3eee3",
  },
};
const sharedRadii = { mochi: 33, bean: 31, pear: 31, wide: 43 };
const CHAIR_R = 18;

function bodyRadius(look) {
  const id = look?.body || "bean";
  return sharedRadii[id] || sharedRadii.bean || 31;
}

function setRadii(table) {
  if (!table || typeof table !== "object") return;
  for (const key of Object.keys(sharedRadii)) {
    const value = Number(table[key]);
    if (Number.isFinite(value) && value > 0) sharedRadii[key] = value;
  }
}

const LALA_LOOK = {
  ...FALLBACK_LOOK,
  head: "ribbon",
  colors: { ...FALLBACK_LOOK.colors, body: "#ff4d88", ear: "#ff4d88", tail: "#ff4d88", accessory: "#e85a6a" },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createWorld({ view, preview, labels, fallback }) {
  const world = {
    ok: false,
    previewOk: false,
    mode: "iso",
    yaw: -0.72,
    heading: -0.72,
    pitch: ISO_PITCH,
    dist: 500,
    followDist: 230,
    followPitch: FOLLOW_PITCH,
    face: 0,
    faceReady: false,
    gazeAim: 0,
    shown: 0,
    camYaw: -0.72,
    steerYaw: -0.72,
    steerHeld: false,
    steerUntil: 0,
    seated: false,
  };
  let renderer;
  let previewRenderer;
  const software = detectSoftware();
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: view,
      antialias: !software,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    showFallback();
    return stub();
  }
  if (!renderer.getContext()) {
    showFallback();
    return stub();
  }
  world.ok = true;
  world.software = software;
  world.quality = qualityTier(renderer);
  world.assetsReady = false;
  renderer.setPixelRatio(pixelCap(world.quality));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral keeps pastel hues instead of washing them toward grey like ACES.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = !world.software;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xf8d0e2, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8d0e2);
  scene.fog = new THREE.Fog(0xf6e6d4, 2600, 5600);
  let envMap = null;
  let extrasMod = null;
  let chatLift = 0;
  let autoFrame = 0;
  const camera = new THREE.PerspectiveCamera(40, 1, 6, 4000);
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const projected = new THREE.Vector3();
  let snapped = false;

  // Cool sky over a warm floor bounce: shaded sides stay clean lilac-grey
  // instead of going muddy brown, and the sun does the warm key work.
  scene.add(new THREE.AmbientLight(0xf6f2ff, 0.28));
  const hemi = new THREE.HemisphereLight(0xf2f0ff, 0xf0dccf, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.4);
  sun.position.set(230, 400, 170);
  sun.castShadow = !world.software;
  const shadowMap = world.quality === "low" ? 512 : 1024;
  sun.shadow.mapSize.set(shadowMap, shadowMap);
  sun.shadow.camera.near = 12;
  sun.shadow.camera.far = 1400;
  sun.shadow.camera.left = -420;
  sun.shadow.camera.right = 420;
  sun.shadow.camera.top = 420;
  sun.shadow.camera.bottom = -420;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = world.quality === "low" ? 0.85 : 0.32;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xe6e8ff, 0.28);
  fill.position.set(-200, 220, 280);
  scene.add(fill);
  let assetsStarted = false;
  let library = {
    settled: false,
    ready: Promise.resolve(),
    progress: { done: 0, total: 0 },
    has() { return false; },
    take() { return null; },
  };
  let composer = null;
  function loadExtras() {
    if (world.quality === "low" || world.software || extrasMod) return;
    import("./vendor/extras.js")
      .then((mod) => {
        extrasMod = mod;
        try {
          const pmrem = new THREE.PMREMGenerator(renderer);
          const room = new mod.RoomEnvironment();
          envMap = pmrem.fromScene(room, 0.04).texture;
          scene.environment = envMap;
          scene.environmentIntensity = 0.18;
          if (previewScene) {
            previewScene.environment = envMap;
            previewScene.environmentIntensity = 0.9;
          }
          pmrem.dispose();
        } catch {
          envMap = null;
        }
        resize();
      })
      .catch((error) => {
        console.warn("extras skipped", error);
      });
  }
  function start() {
    if (assetsStarted) return;
    assetsStarted = true;
    library = createLibrary();
    library.ready.then(() => {
      world.assetsReady = true;
      if (!builtMap) return;
      try {
        propGroup.clear();
        buildProps(builtMap);
        for (const mesh of furnMeshes.values()) furnGroup.remove(mesh);
        furnMeshes.clear();
      } catch (error) {
        console.warn("kenney rebuild", error);
      }
    });
    loadExtras();
  }

  // Three light steps. Characters get a clearly deeper shade band than the
  // room so pale bodies read as round on the pale floor; nothing drops toward black.
  const gradient = stepGradient([176, 222, 255]);
  const skinGradient = stepGradient([100, 180, 255]);
  const blobTexture = softBlob();
  const { creature, paintFace, poseBody } = createAvatars({ mat, geo, addMesh, smoothSphere, blobTexture });
  const mats = new Map();
  const geos = new Map();
  const root = new THREE.Group();
  scene.add(root);
  const floorGroup = new THREE.Group();
  const wallGroup = new THREE.Group();
  const propGroup = new THREE.Group();
  const furnGroup = new THREE.Group();
  const actorGroup = new THREE.Group();
  const fxGroup = new THREE.Group();
  root.add(floorGroup, wallGroup, propGroup, furnGroup, actorGroup, fxGroup);

  const walls = [];
  const furnMeshes = new Map();
  const actors = new Map();
  let snackHook = null;
  let stallHook = null;
  let toyHook = null;
  const doorPivots = new Map();
  const floaters = new Map();
  const auras = new Map();
  let auraDisc = null;
  let auraRing = null;
  let builtMap = null;
  let previewActor = null;
  let previewScene = null;
  let previewCamera = null;

  function ensurePreview() {
    if (previewRenderer || !(preview instanceof HTMLCanvasElement)) return;
    try {
      previewRenderer = new THREE.WebGLRenderer({ canvas: preview, antialias: true, alpha: true });
      if (!previewRenderer.getContext()) throw new Error("preview webgl");
      world.previewOk = true;
      const previewCap = window.matchMedia("(max-width: 980px)").matches ? 1.25 : 1.5;
      previewRenderer.setPixelRatio(Math.min(previewCap, window.devicePixelRatio || 1));
      previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      previewRenderer.toneMapping = THREE.NoToneMapping;
      previewRenderer.toneMappingExposure = 1;
      previewRenderer.setClearColor(0xfff6fb, 1);
      previewScene = new THREE.Scene();
      if (envMap) {
        previewScene.environment = envMap;
        previewScene.environmentIntensity = 0.9;
      }
      previewScene.add(new THREE.AmbientLight(0xfff8f4, 0.82));
      previewScene.add(new THREE.HemisphereLight(0xfffaf6, 0xf6dcc4, 1.22));
      const key = new THREE.DirectionalLight(0xfff7f1, 1.28);
      key.position.set(28, 72, 96);
      previewScene.add(key);
      const fillLight = new THREE.DirectionalLight(0xfff1e6, 0.72);
      fillLight.position.set(-48, 36, 84);
      previewScene.add(fillLight);
      const lift = new THREE.DirectionalLight(0xfff6ee, 0.38);
      lift.position.set(0, 24, 140);
      previewScene.add(lift);
      previewCamera = new THREE.PerspectiveCamera(26, 1, 1, 800);
      previewCamera.position.set(0, 70, 220);
      previewCamera.lookAt(0, 48, 0);
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => syncPreviewSize());
        observer.observe(preview);
      }
    } catch {
      previewRenderer = null;
      world.previewOk = false;
    }
  }

  function showFallback() {
    if (fallback) fallback.hidden = false;
  }

  function stub() {
    const rectOf = () => view.getBoundingClientRect();
    return {
      ok: false,
      previewOk: false,
      assetsReady: true,
      assetsProgress: { done: 0, total: 0 },
      quality: "low",
      mode: "iso",
      resize() {},
      sync() {},
      preview() {},
      start() {},
      setRadii() {},
      radius() { return 31; },
      nudge() {},
      gap() { return null; },
      orbit() {},
      zoom() {},
      aim() {},
      homeDist() { return 500; },
      get fogNear() { return 520; },
      toggle() {},
      axes() {
        return { forwardX: 0, forwardY: -1, rightX: 1, rightY: 0 };
      },
      get shown() { return 0; },
      get gazeAim() { return 0; },
      get cameraHeading() { return 0; },
      actorHeading() { return null; },
      forgetFace() {},
      get pitch() { return 0; },
      setStallHook() {},
      screenToWorld(clientX, clientY) {
        const rect = rectOf();
        return { x: clientX - rect.left, y: clientY - rect.top };
      },
      worldToScreen(x, y) {
        const rect = rectOf();
        return { x: rect.left + x, y: rect.top + y };
      },
    };
  }

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

  function ownMaterials(object) {
    object.traverse((node) => {
      if (!node.isMesh || node.userData.owned) return;
      const material = node.material.clone();
      node.material = material;
      node.userData.owned = true;
      node.userData.baseOpacity = material.opacity;
      node.userData.baseTransparent = material.transparent;
      node.userData.baseDepthWrite = material.depthWrite;
    });
  }

  function setFade(object, faded) {
    object.traverse((node) => {
      if (!node.isMesh || Boolean(node.userData.faded) === faded) return;
      node.userData.faded = faded;
      // Outline materials are shared, so hide the edge instead of fading it.
      if (node.userData.outline) {
        node.visible = !faded;
        return;
      }
      const material = node.material;
      if (!faded) {
        material.opacity = node.userData.baseOpacity ?? 1;
        material.transparent = Boolean(node.userData.baseTransparent);
        material.depthWrite = node.userData.baseDepthWrite !== false;
      } else {
        material.transparent = true;
        material.depthWrite = false;
        material.opacity = 0.13 * (node.userData.baseOpacity ?? 1);
      }
      material.needsUpdate = true;
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

  function floorStyle(zone) {
    const id = zone?.id || "hall";
    const tones = {
      office: 0xeceae8,
      hall: 0xe6e3e1,
      reception: 0xeae7e5,
      men: 0xe5e6e8,
      women: 0xeae6e6,
      pantry: 0xe7e4e2,
      gym: 0xe6e8ec,
      sofa: 0xebe8e6,
      meeting: 0xe8e5e3,
      game: 0xe9e6e4,
    };
    return { key: `plain|${id}`, map: floorTextures.plain, tint: tones[id] || 0xe8e6e4 };
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

  const floorTextures = {
    plain: patternTexture("plain"),
  };

  function buildFloor(map) {
    const buckets = new Map();
    const color = new THREE.Color();
    for (let ty = 0; ty < map.rows; ty++) {
      for (let tx = 0; tx < map.cols; tx++) {
        if (map.walls[ty]?.[tx] === "1") continue;
        const zone = (map.zones || []).find((item) => tx >= item.x && ty >= item.y && tx < item.x + item.w && ty < item.y + item.h);
        const style = floorStyle(zone);
        let bucket = buckets.get(style.key);
        if (!bucket) {
          bucket = { positions: [], colors: [], uvs: [], style };
          buckets.set(style.key, bucket);
        }
        let shade = 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (map.walls[ty + dy]?.[tx + dx] === "1") shade = 0.94;
        }
        color.setHex(style.tint);
        color.multiplyScalar(shade);
        const x0 = tx * TILE;
        const z0 = ty * TILE;
        const x1 = x0 + TILE;
        const z1 = z0 + TILE;
        const y = 0;
        // Winding faces +Y. The opposite order is the underside, which the
        // overhead camera culls, so the pink clear color shows through.
        bucket.positions.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1);
        const u0 = x0 / 64;
        const v0 = z0 / 64;
        const u1 = x1 / 64;
        const v1 = z1 / 64;
        bucket.uvs.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
        for (let i = 0; i < 6; i++) bucket.colors.push(color.r, color.g, color.b);
      }
    }
    for (const bucket of buckets.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, mat(0xffffff, world.software ? {
        basic: true,
        vertexColors: true,
        map: bucket.style.map,
        mapName: `basic-${bucket.style.key}`,
      } : {
        clay: true,
        roughness: 0.98,
        env: 0.2,
        vertexColors: true,
        map: bucket.style.map,
        mapName: bucket.style.key,
      }));
      mesh.receiveShadow = !world.software && world.quality !== "low";
      floorGroup.add(mesh);
    }
    for (const zone of map.zones || []) {
      if (zone.id === "hall") continue;
      floorGroup.add(zoneLabel(zone));
    }
  }

  function zoneLabel(zone) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(92, 62, 58, 0.78)";
    ctx.font = "800 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(zone.name, 256, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(zone.w * TILE * 0.42, 132), 28),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    // Tip the plane onto the floor, then yaw it so the top of the glyphs
    // points toward the top of the default overhead view. Keep the words
    // beside the doorway so people standing in the room do not cover them.
    const spot = zoneLabelAnchor(zone);
    mesh.rotation.order = "YXZ";
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.y = world.yaw;
    mesh.position.set(spot.x * TILE, 0.9, spot.y * TILE);
    return mesh;
  }

  function zoneLabelAnchor(zone) {
    const nearDoor = {
      reception: { x: zone.x + zone.w - 2.4, y: zone.y + zone.h - 1.25 },
      meeting: { x: zone.x + zone.w - 2.2, y: zone.y + zone.h - 1.25 },
      game: { x: zone.x + 1.7, y: zone.y + zone.h - 1.2 },
      office: { x: zone.x + 2.6, y: zone.y + 1.15 },
      men: { x: zone.x + zone.w - 1.8, y: zone.y + 1.35 },
      women: { x: zone.x + zone.w - 1.8, y: zone.y + 1.35 },
      pantry: { x: zone.x + 1.5, y: zone.y + 1.35 },
      gym: { x: zone.x + zone.w - 1.6, y: zone.y + 1.35 },
      sofa: { x: zone.x + zone.w - 1.7, y: zone.y + 1.45 },
    };
    return nearDoor[zone.id] || { x: zone.x + 1.6, y: zone.y + zone.h - 1.3 };
  }

  function wallRuns(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    const used = Array.from({ length: rows }, () => Array(cols).fill(false));
    const runs = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== "1" || used[y][x]) continue;
        let x1 = x;
        while (x1 + 1 < cols && grid[y][x1 + 1] === "1" && !used[y][x1 + 1]) x1 += 1;
        let y1 = y;
        if (x1 === x) {
          while (y1 + 1 < rows && grid[y1 + 1][x] === "1" && !used[y1 + 1][x]) y1 += 1;
        }
        for (let yy = y; yy <= y1; yy++) {
          for (let xx = x; xx <= x1; xx++) used[yy][xx] = true;
        }
        runs.push({ x, y, w: x1 - x + 1, h: y1 - y + 1 });
      }
    }
    return runs;
  }

  function buildWalls(map) {
    const plaster = mat(0xf3b4d0);
    const trim = mat(0xfffaf6);
    const cap = mat(0xfffdfb);
    for (const run of wallRuns(map.walls)) {
      const alongX = run.w >= run.h;
      const span = (alongX ? run.w : run.h) * TILE;
      const thick = Math.min(WALL_T, (alongX ? run.h : run.w) * TILE - 4);
      const width = alongX ? Math.max(8, span - 4) : thick;
      const depth = alongX ? thick : Math.max(8, span - 4);
      const mesh = new THREE.Mesh(roundedBox(width, WALL_H, depth, 3), plaster);
      const cx = run.x * TILE + (run.w * TILE) / 2;
      const cz = run.y * TILE + (run.h * TILE) / 2;
      mesh.position.set(cx, WALL_H / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const skirt = new THREE.Mesh(roundedBox(width + 1.2, 4.2, depth + 1.2, 1.5), trim);
      skirt.position.set(0, -WALL_H / 2 + 2.1, 0);
      mesh.add(skirt);
      const lip = new THREE.Mesh(roundedBox(width + 1.4, 4.6, depth + 1.4, 1.6), cap);
      lip.position.set(0, WALL_H / 2 - 2.1, 0);
      mesh.add(lip);
      mesh.userData.occlude = true;
      ownMaterials(mesh);
      wallGroup.add(mesh);
      walls.push({
        mesh,
        h: WALL_H,
        minX: cx - width / 2,
        maxX: cx + width / 2,
        minZ: cz - depth / 2,
        maxZ: cz + depth / 2,
      });
    }
  }

  function textPlane(label, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff8f3";
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = "#e7b4cb";
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, 244, 84);
    ctx.fillStyle = "#6a4a68";
    ctx.font = "700 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture }));
  }

  function buildProps(map) {
    doorPivots.clear();
    for (const prop of map.props || []) {
      propGroup.add(makeProp(prop));
    }
  }

  function placeStall(prop, group) {
    if (typeof stallHook !== "function") return false;
    if (prop.kind !== "stallwall" && prop.kind !== "stalldoor" && prop.kind !== "toilet") return false;
    const take = (name, boxW, boxH, opts) => (library.settled ? library.take(name, boxW, boxH, opts) : null);
    return stallHook(prop, group, { take }) === true;
  }

  function paintNames(object, names, color, scale = 1) {
    const hex = cssColor(color, 0xfff6ea);
    object.traverse((node) => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!names.includes(material.name)) continue;
        material.color.setHex(hex);
        if (scale !== 1) material.color.multiplyScalar(scale);
      }
    });
  }

  function glowPlane(parent, model, color) {
    const fit = model?.userData?.fit;
    if (!fit) return;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(6, fit.size.x * fit.sx * 0.62), Math.max(4, fit.size.y * fit.sy * 0.46)),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    mesh.position.set(0, model.position.y + fit.size.y * fit.sy * 0.58, fit.size.z * fit.sz * 0.5 + 0.8);
    parent.add(mesh);
  }

  function kenneyProp(prop, group) {
    if (!library.settled) return false;
    const w = prop.w;
    const h = prop.h;
    if (prop.kind === "desk") {
      const model = library.take("desk", w * 0.92, h * 0.9, { maxHeight: 34, stretch: 1.55 });
      if (!model) return false;
      group.add(model);
      const top = model.userData.fit.size.y * model.userData.fit.sy;
      // Back edge of the top: the monitor stands in front of the divider, not through it.
      addMesh(group, roundedBox(w * 0.62, 13, 1.6, 1), mat(0xd9c8f5, { clay: true, roughness: 0.9 }), 0, top + 6, -h * 0.42);
      contactShadow(group, w * 0.36, h * 0.36);
      return true;
    }
    if (prop.kind === "counter") {
      const count = Math.max(1, Math.round(w / 34));
      const slot = w / count;
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const piece = library.take("kitchenCabinet", slot * 0.98, Math.max(28, h), { maxHeight: 32, stretch: 1.2 });
        if (!piece) return false;
        piece.position.x = -w / 2 + slot * (i + 0.5);
        group.add(piece);
        placed += 1;
      }
      if (!placed) return false;
      contactShadow(group, w * 0.46, h * 0.6);
      return true;
    }
    if (prop.kind === "table") {
      const model = library.take("table", w * 0.94, h * 0.92, { maxHeight: 32, stretch: 1.7 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, w * 0.4, h * 0.4);
      return true;
    }
    if (prop.kind === "rug") {
      const model = library.take("rugRounded", w * 0.98, h * 0.98, { maxHeight: 3, stretch: 1.85 });
      if (!model) return false;
      group.add(model);
      group.userData.paint = () => {
        paintNames(group, ["carpet", "carpetWhite", "carpetBlue"], prop.tint || "#f7c6d4");
        paintNames(group, ["carpetDarker"], prop.tint || "#f7c6d4", 0.78);
      };
      return true;
    }
    if (prop.kind === "tv") {
      const stand = library.take("cabinetTelevision", 56, 28, { maxHeight: 26, stretch: 1.25 });
      const screen = library.take("televisionModern", 62, 18, { maxHeight: 34, stretch: 1.15 });
      if (!screen) return false;
      if (stand) group.add(stand);
      const standH = stand ? stand.userData.fit.size.y * stand.userData.fit.sy : 0;
      screen.position.y = standH - 2;
      group.add(screen);
      glowPlane(group, screen, 0x8fd4ff);
      return true;
    }
    if (prop.kind === "mirror") {
      const model = library.take("bath-mirror", w * 0.6, 4, { maxHeight: 15, stretch: 1.2 });
      if (!model) return false;
      model.position.y = 26;
      model.position.z = -h / 2 + 2;
      group.add(model);
      return true;
    }
    if (prop.kind === "sink") {
      const model = library.take("bath-sink", w, h, { maxHeight: 34, stretch: 1.2 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, w * 0.42, h * 0.42);
      return true;
    }
    if (prop.kind === "decor") {
      // Quarter turns swap the footprint, so fit the model to the unturned box.
      const turned = ((prop.rot || 0) / 90) % 2 === 1;
      const model = library.take(prop.model, turned ? h : w, turned ? w : h, {
        maxHeight: prop.tall || 32,
        stretch: 1.25,
        lift: prop.lift || 0,
        yaw: THREE.MathUtils.degToRad(prop.rot || 0),
      });
      if (!model) return false;
      group.add(model);
      if (prop.solid) contactShadow(group, w * 0.42, h * 0.42);
      return true;
    }
    return false;
  }

  function makeProp(prop) {
    const group = new THREE.Group();
    const cx = prop.x + prop.w / 2;
    const cz = prop.y + prop.h / 2;
    let occlude = true;
    const dressed = kenneyProp(prop, group) || placeStall(prop, group);
    if (dressed && (prop.kind === "rug" || prop.kind === "mirror" || prop.kind === "tv" || (prop.kind === "decor" && !prop.solid))) occlude = false;
    if (dressed) {
      /* Kenney mesh already fills the footprint. */
    } else if (prop.kind === "desk") {
      contactShadow(group, prop.w * 0.42, prop.h * 0.46);
      addMesh(group, roundedBox(prop.w - 8, 5, prop.h - 10, 3), mat(0xf0d2a4), 0, 24, 0, { cast: true, receive: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), -prop.w * 0.36, 12, -prop.h * 0.22, { cast: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), prop.w * 0.36, 12, -prop.h * 0.22, { cast: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), -prop.w * 0.36, 12, prop.h * 0.22, { cast: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), prop.w * 0.36, 12, prop.h * 0.22, { cast: true });
      addMesh(group, roundedBox(prop.w - 18, 14, 2.4, 1.5), mat(0xd5c6f2), 0, 34, -prop.h * 0.38);
    } else if (prop.kind === "counter") {
      contactShadow(group, prop.w * 0.46, prop.h * 0.7);
      addMesh(group, roundedBox(prop.w - 4, 26, prop.h + 8, 6), mat(0xf6d7c2), 0, 16, 0, { cast: true });
      addMesh(group, roundedBox(prop.w - 16, 4, prop.h, 3), mat(0xfffaf6), 0, 31, 0);
    } else if (prop.kind === "table") {
      contactShadow(group, prop.w * 0.36, prop.h * 0.42);
      const radius = Math.max(18, (prop.h - 14) / 2);
      addMesh(group, geo(`roundTop|${radius}`, () => new THREE.CylinderGeometry(radius, radius, 5, 28)), mat(0xf0d2a4), 0, 22, 0, { sx: (prop.w - 16) / (radius * 2), cast: true });
      addMesh(group, geo("pedestal", () => new THREE.CylinderGeometry(3.2, 4.2, 18, 12)), mat(0xe7c79a), 0, 12, 0, { cast: true });
    } else if (prop.kind === "arcade") {
      contactShadow(group, prop.w * 0.4, prop.h * 0.36);
      const body = cssColor(prop.tint, prop.use === "play" ? 0xd9c8f5 : 0xf7b7d0);
      addMesh(group, roundedBox(prop.w - 4, 50, prop.h * 0.5, 5), mat(body), 0, 28, -6, { cast: true });
      const screen = new THREE.Group();
      screen.position.set(0, 46, prop.h * 0.02);
      screen.rotation.x = -0.62;
      addMesh(screen, roundedBox(prop.w - 14, 24, 2.2, 2), mat(0x241c30), 0, 0, 0);
      addMesh(screen, roundedBox(prop.w - 20, 16, 1.1, 1), mat(0x7ad8ff, { emissive: 0x3ec0ff }), 0, 1, 1.4);
      group.add(screen);
      addMesh(group, roundedBox(prop.w - 2, 7, prop.h * 0.34, 2), mat(0xffe08a, { emissive: 0xffc85a }), 0, 62, -4, { cast: true });
      addMesh(group, roundedBox(prop.w - 10, 3.2, 1.2, 1), mat(0xfff6c8, { emissive: 0xffe08a }), 0, 62, prop.h * 0.08);
      const deck = new THREE.Group();
      deck.position.set(0, 20, prop.h * 0.3);
      deck.rotation.x = 0.42;
      addMesh(deck, roundedBox(prop.w - 8, 3.2, 18, 2), mat(0x3a3050), 0, 0, 0, { cast: true });
      addMesh(deck, geo("stick", () => new THREE.CylinderGeometry(0.7, 0.9, 7, 8)), mat(0x2a2434), -8, 4.2, 1);
      addMesh(deck, smoothSphere(1.8, 12, 10), mat(0xf26d9a), -8, 8.2, 1);
      addMesh(deck, geo("btn", () => new THREE.CylinderGeometry(1.5, 1.7, 1.6, 10)), mat(0xf26d9a), 2, 1.6, 2);
      addMesh(deck, geo("btn", () => new THREE.CylinderGeometry(1.5, 1.7, 1.6, 10)), mat(0x7ec8e8), 6.2, 1.6, 1);
      addMesh(deck, geo("btn", () => new THREE.CylinderGeometry(1.5, 1.7, 1.6, 10)), mat(0xffe08a), 10.2, 1.6, 3);
      group.add(deck);
    } else if (prop.kind === "scoreboard") {
      contactShadow(group, prop.w * 0.4, 10);
      addMesh(group, roundedBox(8, 36, 8, 2), mat(0xc9b18a), -prop.w * 0.32, 18, 0, { cast: true });
      addMesh(group, roundedBox(8, 36, 8, 2), mat(0xc9b18a), prop.w * 0.32, 18, 0, { cast: true });
      addMesh(group, roundedBox(prop.w, 32, 4, 3), mat(0xfff8f1), 0, 40, 0, { cast: true });
      const board = textPlane(prop.label || "排行榜", prop.w - 8, 18);
      board.position.set(0, 42, 3);
      group.add(board);
    } else if (prop.kind === "mirror") {
      addMesh(group, roundedBox(prop.w, 22, 3, 3), mat(0xf4e2c4), 0, 36, 0, { cast: true });
      addMesh(group, roundedBox(prop.w - 6, 14, 1.4, 2), mat(0xd7f4ff, { emissive: 0xc6ecff }), 0, 36, 2);
      occlude = false;
    } else if (prop.kind === "rug") {
      const rug = rugMesh(prop.w, prop.h, prop.tint || "#f8c3d6");
      rug.position.y = 0.7;
      group.add(rug);
      occlude = false;
    } else if (prop.kind === "window") {
      addMesh(group, roundedBox(prop.w, 22, 3, 3), mat(0xfffaf6), 0, 40, 0);
      addMesh(group, roundedBox(prop.w - 8, 14, 1.4, 2), mat(0xd9f3ff, { emissive: 0xc8ebff }), 0, 40, 2);
      addMesh(group, roundedBox(prop.w + 2, 5, 4, 1.5), mat(0xd9c8f5), 0, 52, 0);
      occlude = false;
    } else if (prop.kind === "frame") {
      addMesh(group, roundedBox(prop.w, 22, 2.2, 1.5), mat(0xf0d2a4), 0, 40, 0);
      addMesh(group, roundedBox(prop.w - 6, 16, 1.2, 1), mat(cssColor(prop.tint, 0xf7c6d4)), 0, 40, 1.4);
      occlude = false;
    } else if (prop.kind === "beanbag") {
      contactShadow(group, prop.w * 0.46, prop.h * 0.46);
      addMesh(group, smoothSphere(15, 20, 16), mat(0xd4c2f4), 0, 9, 1, { sx: 1.4, sy: 0.5, sz: 1.22, cast: true });
      addMesh(group, smoothSphere(12, 18, 14), mat(0xcbb6ee), -2, 22, -1, { sx: 1.18, sy: 1.05, sz: 1.05, cast: true });
      addMesh(group, smoothSphere(9, 16, 12), mat(0xe8daf8), 3, 38, 2, { sx: 1.12, sy: 0.95, sz: 1.02, cast: true });
      addMesh(group, smoothSphere(4.5, 12, 10), mat(0xf3e9ff), -4, 30, 6, { sx: 1.2, sy: 0.7, sz: 0.85 });
    } else if (prop.kind === "tv") {
      addMesh(group, roundedBox(prop.w + 8, 8, 10, 2), mat(0xe7c79a), 0, 16, 0);
      addMesh(group, roundedBox(prop.w, 16, 2.4, 1.5), mat(0x2c2834), 0, 28, 0);
      addMesh(group, roundedBox(prop.w - 4, 12, 1.2, 1), mat(0x9fd4ee, { emissive: 0x7ec4ea }), 0, 28, 1.6);
      occlude = false;
    } else if (prop.kind === "sign") {
      const sign = textPlane(prop.label || "", prop.w, 18);
      sign.position.set(0, 34, 0);
      group.add(sign);
      occlude = false;
    } else if (prop.kind === "decor") {
      // A missing model leaves an empty spot rather than a stand-in block.
      occlude = false;
    } else {
      addMesh(group, roundedBox(prop.w, 16, prop.h, 4), mat(0xe6d4c8), 0, 8, 0, { cast: true });
    }
    group.position.set(cx, 0, cz);
    if (prop.kind === "stalldoor" && group.userData.doorPivot) doorPivots.set(prop.id, group.userData.doorPivot);
    group.userData.occlude = occlude;
    if (occlude || group.userData.paint) ownMaterials(group);
    if (group.userData.paint) group.userData.paint();
    return group;
  }

  function itemSize(item, specs) {
    const spec = specs.get(item.kind);
    if (!spec) return { w: 32, h: 24 };
    const rot = ((item.rot || 0) % 360 + 360) % 360;
    if (rot % 180 !== 0) return { w: spec.h, h: spec.w };
    return { w: spec.w, h: spec.h };
  }

  const DESK_TOP = 34;

  function kenneyItem(item, group) {
    if (!library.settled) return false;
    const kind = item.kind;
    const place = (name, w, h, opts = {}) => library.take(name, w, h, opts);
    if (kind === "monitor") {
      const model = place("computerScreen", 36, 14, { maxHeight: 26, stretch: 1.15 });
      if (!model) return false;
      model.position.y = DESK_TOP;
      group.add(model);
      glowPlane(group, model, 0x9fd8ff);
      contactShadow(group, 16, 12);
      return true;
    }
    if (kind === "keyboard") {
      const model = place("computerKeyboard", 32, 12, { maxHeight: 3.2, stretch: 1.1 });
      if (!model) return false;
      model.position.y = DESK_TOP;
      group.add(model);
      return true;
    }
    if (kind === "mouse") {
      const model = place("computerMouse", 8, 12, { maxHeight: 4, stretch: 1.05 });
      if (!model) return false;
      model.position.y = DESK_TOP;
      group.add(model);
      return true;
    }
    if (kind === "chair") {
      const meet = String(item.id || "").startsWith("meet-");
      const model = place(meet ? "chairRounded" : "chairDesk", meet ? 26 : 32, meet ? 24 : 26, { maxHeight: meet ? 40 : 36 });
      if (!model) return false;
      group.add(model);
      group.userData.paint = () => {
        if (meet) paintNames(group, ["wood", "woodDark"], 0xfff6ea);
        else paintNames(group, ["carpet", "carpetBlue"], 0xd4c4f4);
      };
      contactShadow(group, 16, 16);
      return true;
    }
    if (kind === "plant") {
      const model = place("pottedPlant", 24, 26, { maxHeight: 52 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 12, 12);
      return true;
    }
    if (kind === "cactus") {
      const model = place("plantSmall1", 18, 18, { maxHeight: 32 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 10, 10);
      return true;
    }
    if (kind === "lamp") {
      const model = place("lampSquareFloor", 16, 16, { maxHeight: 70 });
      if (!model) return false;
      group.add(model);
      return true;
    }
    if (kind === "coffee") {
      const model = place("kitchenCoffeeMachine", 26, 28, { maxHeight: 32, stretch: 1.1 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 12, 12);
      return true;
    }
    if (kind === "water") {
      const model = place("gym-cooler", 22, 22, { maxHeight: 50, stretch: 1.2 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 12, 14);
      return true;
    }
    if (kind === "console") {
      const model = place("laptop", 32, 18, { maxHeight: 16, stretch: 1.15 });
      if (!model) return false;
      group.add(model);
      return true;
    }
    if (kind === "speaker") {
      const model = place("speaker", 16, 16, { maxHeight: 48 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 8, 8);
      return true;
    }
    if (kind === "sofa") {
      const model = place("loungeSofa", 72, 36, { maxHeight: 34, stretch: 1.08 });
      if (!model) return false;
      group.add(model);
      const pillowA = place("pillow", 18, 10, { maxHeight: 12 });
      const pillowB = place("pillow", 16, 10, { maxHeight: 11 });
      if (pillowA) {
        pillowA.position.set(-16, 20, 4);
        group.add(pillowA);
      }
      if (pillowB) {
        pillowB.position.set(14, 20, 6);
        pillowB.rotation.y = 0.4;
        group.add(pillowB);
      }
      group.userData.paint = () => {
        paintNames(group, ["carpet"], 0xfff8f1);
        if (pillowA) paintNames(pillowA, ["carpet"], 0xd9c8f5);
        if (pillowB) paintNames(pillowB, ["carpet"], 0xf7c6d4);
      };
      contactShadow(group, 34, 18);
      return true;
    }
    if (kind === "bin") {
      const model = place("trashcan", 16, 18, { maxHeight: 22 });
      if (!model) return false;
      group.add(model);
      return true;
    }
    if (kind === "coffeetable") {
      const w = 88;
      const h = 40;
      const model = place("tableCoffee", w * 0.94, h * 0.9, { maxHeight: 20, stretch: 1.45 });
      if (!model) return false;
      group.add(model);
      const books = place("books", 18, 12, { maxHeight: 8, stretch: 1.1 });
      if (books) {
        books.position.set(-w * 0.16, 18, 0);
        group.add(books);
      }
      contactShadow(group, w * 0.4, h * 0.4);
      return true;
    }
    if (kind === "toyrack") {
      const model = place("bookcaseOpenLow", 46, 26, { maxHeight: 34, stretch: 1.2 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 22, 12);
      return true;
    }
    if (kind === "shelf") {
      const model = place("bookcaseOpen", 46, 26, { maxHeight: 78, stretch: 1.1 });
      if (!model) return false;
      group.add(model);
      const fit = model.userData.fit;
      const height = fit.size.y * fit.sy;
      for (const spot of [0.28, 0.52, 0.74]) {
        const books = place("books", 16, 10, { maxHeight: 12 });
        if (!books) continue;
        books.position.set((spot - 0.5) * 24, height * spot, 2);
        group.add(books);
      }
      contactShadow(group, 20, 12);
      return true;
    }
    return false;
  }

  function snackSign(text, w, h, bg, fg) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = fg;
    ctx.font = "700 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    return mesh;
  }

  function placeKenney(group, name, w, h, maxHeight, x, y, z, yaw = 0) {
    const model = library.take(name, w, h, { maxHeight, stretch: 1.15, yaw });
    if (!model) return false;
    model.position.set(x, y, z);
    group.add(model);
    return true;
  }

  // Food Kit has plates, cookies, cupcakes, donuts, and a teacup. No teapot or cake stand.
  function afternoonTea(group) {
    if (!library.settled || !library.has("plate") || !library.has("cup-tea")) return false;
    const counter = 35;
    const placed = [
      placeKenney(group, "plate", 16, 16, 2.4, -6, counter, 2, 0.2),
      placeKenney(group, "cookie", 5.2, 5.2, 1.6, -8.4, counter + 1.3, 3.4, 0.5),
      placeKenney(group, "cookie", 4.6, 4.6, 1.4, -4.1, counter + 1.3, 1.1, -0.7),
      placeKenney(group, "cupcake", 6.2, 6.2, 8, -6.1, counter + 1.3, 0.2, 0.15),
      placeKenney(group, "donut", 5.6, 5.6, 2.2, 2.2, counter, -2, 0.4),
      placeKenney(group, "cup-tea", 6.2, 5.6, 7.5, 8.2, counter, 2.4, -0.5),
    ];
    return placed.filter(Boolean).length >= 4;
  }

  function buildSnackMachine(group, kind) {
    const vendor = kind === "vendor";
    contactShadow(group, vendor ? 14 : 18, vendor ? 13 : 14);
    if (!vendor) {
      addMesh(group, roundedBox(36, 34, 26, 4), mat(0xfff7ef), 0, 18, 0, { cast: true });
      addMesh(group, roundedBox(32, 2.2, 20, 1), mat(0xf3e2cf), 0, 14, 1);
      addMesh(group, roundedBox(32, 2.2, 20, 1), mat(0xf3e2cf), 0, 24, 1);
      const glass = new THREE.MeshBasicMaterial({ color: 0xdff6ee, transparent: true, opacity: 0.42, depthWrite: false });
      addMesh(group, roundedBox(30, 20, 1.2, 2), glass, 0, 20, 13.2);
      if (!afternoonTea(group)) {
        const treats = [[0xf0c07a, -8, 18], [0x8a5638, 0, 18], [0xf26d9a, 8, 18], [0xfffdfb, -4, 28], [0xffb067, 6, 28]];
        for (const [color, x, y] of treats) {
          addMesh(group, geo("treat", () => new THREE.SphereGeometry(2.1, 12, 10)), mat(color), x, y, 8);
        }
      }
      const sign = snackSign("零食", 18, 5.5, "#fff7ef", "#d36b90");
      sign.position.set(0, 33, 13.4);
      group.add(sign);
      return;
    }
    const machine = library.settled ? library.take("vending-machine", 32, 30, { maxHeight: 50, stretch: 1.2 }) : null;
    if (machine) {
      group.add(machine);
      return;
    }
    addMesh(group, roundedBox(28, 48, 24, 4), mat(0xf3f1ee), 0, 25, 0, { cast: true });
    const glass = new THREE.MeshBasicMaterial({ color: 0xd5e6f6, transparent: true, opacity: 0.4, depthWrite: false });
    addMesh(group, roundedBox(22, 26, 1.2, 2), glass, 0, 30, 12.2);
    const cans = [[0x7dca78, -6, 36], [0xf08aab, 0, 36], [0xffb067, 6, 36], [0xf2d7a4, -6, 26], [0xc9b6ee, 0, 26], [0x8ec8e6, 6, 26]];
    for (const [color, x, y] of cans) {
      addMesh(group, geo("can", () => new THREE.CylinderGeometry(1.6, 1.6, 5, 10)), mat(color), x, y, 8.5);
    }
    addMesh(group, roundedBox(14, 3.4, 5, 1.2), mat(0x6a5a78), 0, 10, 10);
    const sign = snackSign("飲料", 16, 5, "#f3f1ee", "#5c4d78");
    sign.position.set(0, 46.2, 12.4);
    group.add(sign);
  }

  function makeFurniture(item) {
    const group = new THREE.Group();
    const kind = item.kind;
    const dressed = kenneyItem(item, group);
    if (dressed) {
      /* Kenney mesh already fills this item. */
    } else if (kind === "monitor") {
      contactShadow(group, 16, 12);
      addMesh(group, geo("neck", () => new THREE.CylinderGeometry(1.6, 2, 14, 8)), mat(0xd9c8b4), 0, 33, 0, { cast: true });
      addMesh(group, roundedBox(34, 22, 3.4, 3), mat(0xf7f4ef), 0, 48, 0, { cast: true });
      addMesh(group, roundedBox(28, 16, 1.2, 2), mat(0xb7e4ff, { emissive: 0x8fd0ff }), 0, 48, 2.2);
    } else if (kind === "keyboard") {
      addMesh(group, roundedBox(32, 2.4, 12, 2), mat(0xfffdfb), 0, 28.4, 0, { cast: true });
      addMesh(group, roundedBox(26, 1.2, 7, 1), mat(0xe7d8ea), 0, 30, 0);
    } else if (kind === "mouse") {
      addMesh(group, geo("mouse", () => new THREE.SphereGeometry(4.2, 12, 10)), mat(0xfffdfb), 0, 29, 0, { sx: 1, sy: 0.55, sz: 1.25, cast: true });
    } else if (kind === "chair") {
      contactShadow(group, 16, 16);
      const wheels = [];
      for (let i = 0; i < 5; i++) {
        const arm = new THREE.Group();
        arm.rotation.y = (i / 5) * Math.PI * 2;
        addMesh(arm, geo("casterArm", () => new THREE.BoxGeometry(11, 1.3, 2.1)), mat(0xcbb8a4), 5.6, 2.2, 0);
        const wheel = new THREE.Group();
        wheel.position.set(11.4, 1.7, 0);
        addMesh(wheel, geo("casterWheel", () => new THREE.CylinderGeometry(1.7, 1.7, 1.5, 12)), mat(0x3a3340), 0, 0, 0, { rotX: Math.PI / 2 });
        arm.add(wheel);
        group.add(arm);
        wheels.push(wheel);
      }
      addMesh(group, geo("chairGas", () => new THREE.CylinderGeometry(1.45, 1.8, 9, 12)), mat(0xe4dcd2), 0, 7.4, 0);
      const seat = new THREE.Group();
      group.add(seat);
      const creamSeat = String(item.id || "").startsWith("meet-");
      const seatColor = creamSeat ? 0xfff6ea : 0xcbb6ee;
      const backColor = creamSeat ? 0xf4ece3 : 0xbfa8e4;
      addMesh(seat, roundedBox(24, 5, 22, 5), mat(seatColor), 0, 14.5, 1, { cast: true });
      addMesh(seat, roundedBox(22, 15, 3.6, 3), mat(backColor), 0, 22, -8, { cast: true });
      group.userData.wheels = wheels;
      group.userData.seatPivot = seat;
      group.userData.wobble = 0;
    } else if (kind === "plant" || kind === "cactus") {
      contactShadow(group, 12, 12);
      addMesh(group, geo("pot", () => new THREE.CylinderGeometry(7, 5.5, 10, 10)), mat(0xfff6ea), 0, 6, 0, { cast: true });
      const leaf = kind === "cactus" ? 0x7dca78 : 0x7ecf86;
      addMesh(group, geo("leaf", () => new THREE.SphereGeometry(10, 12, 10)), mat(leaf), 0, 20, 0, { cast: true });
      if (kind === "plant") {
        addMesh(group, geo("leaf", () => new THREE.SphereGeometry(8, 12, 10)), mat(0xb6e7a4), 7, 26, 2, { sx: 0.85, sy: 0.75, sz: 0.75 });
        addMesh(group, geo("leaf", () => new THREE.SphereGeometry(7, 12, 10)), mat(0x9edc98), -6, 24, -1, { sx: 0.8, sy: 0.7, sz: 0.7 });
      }
    } else if (kind === "lamp") {
      addMesh(group, geo("lampStem", () => new THREE.CylinderGeometry(1.5, 2, 18, 8)), mat(0xf2d7a4), 0, 12, 0);
      addMesh(group, geo("shade", () => new THREE.ConeGeometry(8, 10, 10)), mat(0xfff1c4, { emissive: 0xffe29a }), 0, 24, 0);
    } else if (kind === "coffee") {
      addMesh(group, roundedBox(18, 20, 16, 4), mat(0xd7b08a), 0, 12, 0, { cast: true });
      addMesh(group, geo("mug", () => new THREE.CylinderGeometry(4, 3.4, 6, 10)), mat(0xfffdfb), 0, 24, 0);
    } else if (kind === "water") {
      addMesh(group, roundedBox(16, 28, 16, 4), mat(0xd7f0ff), 0, 16, 0, { cast: true });
      addMesh(group, geo("bottle", () => new THREE.CylinderGeometry(5, 5, 10, 10)), mat(0xb7e4ff), 0, 32, 0);
    } else if (kind === "console") {
      addMesh(group, roundedBox(28, 6, 16, 3), mat(0xe7d2ff), 0, 6, 0);
    } else if (kind === "speaker") {
      addMesh(group, roundedBox(14, 24, 12, 4), mat(0x6a5a78), 0, 14, 0, { cast: true });
      addMesh(group, geo("speaker", () => new THREE.CircleGeometry(3.2, 12)), mat(0x2c2434), 0, 16, 6.2);
    } else if (kind === "sofa") {
      contactShadow(group, 34, 18);
      addMesh(group, roundedBox(66, 12, 30, 6), mat(0xfff8f1), 0, 12, 2, { cast: true });
      addMesh(group, roundedBox(66, 18, 8, 4), mat(0xf7f0e6), 0, 24, -10, { cast: true });
      addMesh(group, roundedBox(8, 16, 28, 3), mat(0xf3ebe0), -30, 18, 2);
      addMesh(group, roundedBox(8, 16, 28, 3), mat(0xf3ebe0), 30, 18, 2);
      addMesh(group, roundedBox(16, 5, 12, 3), mat(0xe4d4f6), -16, 20, 4);
      addMesh(group, roundedBox(14, 5, 12, 3), mat(0xf7c6d4), 8, 20, 6);
      addMesh(group, roundedBox(12, 4, 10, 3), mat(0xffe08a), 18, 19, 2);
    } else if (kind === "bin") {
      addMesh(group, geo("bin", () => new THREE.CylinderGeometry(6, 5, 12, 10)), mat(0xd5e0ea), 0, 6, 0);
    } else if (kind === "shelf") {
      addMesh(group, roundedBox(44, 28, 10, 3), mat(0xf0d2a4), 0, 18, 0, { cast: true });
      addMesh(group, roundedBox(1.4, 24, 8, 0.4), mat(0xe7c79a), -10, 16, 1);
      addMesh(group, roundedBox(1.4, 24, 8, 0.4), mat(0xe7c79a), 10, 16, 1);
      addMesh(group, roundedBox(10, 8, 6, 1), mat(0xf7c6d4), -16, 22, 2);
      addMesh(group, roundedBox(10, 10, 6, 1), mat(0xd9c8f5), 0, 20, 2);
      addMesh(group, roundedBox(10, 7, 6, 1), mat(0xffe08a), 16, 14, 2);
    } else if (kind === "board") {
      addMesh(group, geo("boardLeg", () => new THREE.CylinderGeometry(1.3, 1.6, 16, 8)), mat(0xe7c79a), -16, 8, 0);
      addMesh(group, geo("boardLeg", () => new THREE.CylinderGeometry(1.3, 1.6, 16, 8)), mat(0xe7c79a), 16, 8, 0);
      addMesh(group, roundedBox(48, 28, 3, 2), mat(0xfffdfb), 0, 30, 0, { cast: true });
      addMesh(group, roundedBox(42, 20, 1, 1), mat(0xf4f7fb), 0, 30, 2);
    } else if (kind === "coffeetable") {
      contactShadow(group, 35, 16);
      addMesh(group, roundedBox(84, 6, 36, 6), mat(0xf0d2a4), 0, 14, 0, { cast: true });
      addMesh(group, roundedBox(16, 2, 12, 1), mat(0xd9c8f5), -10, 18, 0);
      addMesh(group, geo("cup", () => new THREE.CylinderGeometry(3.2, 2.8, 5, 10)), mat(0xfff6ea), 14, 19, 2);
    } else if (kind === "snackcab" || kind === "vendor") {
      buildSnackMachine(group, kind);
    } else if (kind === "toyrack") {
      contactShadow(group, 22, 12);
      addMesh(group, roundedBox(44, 30, 22, 3), mat(0xf0d2a4), 0, 15, 0, { cast: true });
      addMesh(group, roundedBox(40, 1.6, 18, 0.6), mat(0xe7c79a), 0, 15, 2);
    }
    const ring = new THREE.Mesh(geo("ring", () => new THREE.TorusGeometry(16, 1.1, 6, 18)), mat(0xf08aab, { basic: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.4;
    ring.visible = false;
    group.add(ring);
    group.userData.ring = ring;
    group.userData.kind = kind;
    group.userData.occlude = true;
    ownMaterials(group);
    if (group.userData.paint) group.userData.paint();
    return group;
  }


  function signature(look) {
    return JSON.stringify(look || {});
  }

  function ensureActor(id, look, lala = false) {
    const sig = `${lala ? "lala" : "p"}|${signature(look)}`;
    let actor = actors.get(id);
    if (!actor || actor.userData.sig !== sig) {
      if (actor) actorGroup.remove(actor);
      actor = creature(look, { lala });
      actor.userData.sig = sig;
      actors.set(id, actor);
      actorGroup.add(actor);
    }
    actor.userData.pid = id;
    return actor;
  }

  function animateActor(actor, moving, time, moveFace, talking = false, dt = 0.016, gaze = null, gazeRate = 3.4) {
    const sitting = poseBody(actor, moving, time, dt);
    let heading = actor.userData.heading;
    if (heading == null || Number.isNaN(heading)) heading = Number.isFinite(moveFace) ? moveFace : 0;
    let target = heading;
    let rate = gazeRate;
    if ((sitting || moving) && Number.isFinite(moveFace)) {
      target = moveFace;
      rate = 12;
    } else if (!moving && Number.isFinite(gaze)) target = gaze;
    // Shortest-angle exponential ease, so turns look the same at any frame rate.
    const delta = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
    const step = Math.max(0.001, dt);
    // Cap the turn speed too, so an about-face does not start with a big jump.
    heading += Math.abs(delta) < 0.001 ? delta : Math.sign(delta) * Math.min(Math.abs(delta) * (1 - Math.exp(-rate * step)), 10 * step);
    heading = Math.atan2(Math.sin(heading), Math.cos(heading));
    actor.userData.heading = heading;
    actor.rotation.y = heading;
    let phase = (time + Math.abs(heading)) % 4.2;
    if (phase < 0) phase += 4.2;
    if (actor.userData.decal) paintFace(actor.userData.decal, phase > 4.05, Boolean(talking) || Boolean(actor.userData.tasting));
    if (snackHook) snackHook(actor, { sitting, time, dt });
    if (toyHook?.actor) toyHook.actor(actor, { sitting, time, dt });
  }

  function separateBodies(bodies) {
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let dist = Math.hypot(dx, dz);
          const min = (a.r + b.r) * 0.98;
          if (dist >= min) continue;
          if (dist < 0.001) { dx = 1; dz = 0; dist = 1; }
          const push = (min - dist) / dist;
          if (a.pin && b.pin) continue;
          if (a.pin) {
            b.x += dx * push;
            b.z += dz * push;
          } else if (b.pin) {
            a.x -= dx * push;
            a.z -= dz * push;
          } else {
            a.x -= dx * push * 0.5;
            a.z -= dz * push * 0.5;
            b.x += dx * push * 0.5;
            b.z += dz * push * 0.5;
          }
        }
      }
    }
  }

  function nudge(id, nx, nz) {
    const actor = actors.get(id);
    if (!actor) return;
    const now = performance.now();
    const jelly = actor.userData.jelly || { s: 0, v: 0, nx: 0, nz: 1, cool: 0 };
    if (now < jelly.cool) return;
    const len = Math.hypot(nx, nz) || 1;
    jelly.s = 0.22;
    jelly.v = 0;
    jelly.nx = nx / len;
    jelly.nz = nz / len;
    jelly.cool = now + 480;
    actor.userData.jelly = jelly;
  }

  function syncActors(state, time, dt) {
    const keep = new Set();
    if (state.map?.lala) {
      const lala = state.map.lala;
      const actor = ensureActor("lala", LALA_LOOK, true);
      keep.add("lala");
      actor.position.set(lala.x, 0, lala.y);
      const gaze = lalaHeading(lala, state.me, state.map.talk);
      if (!Number.isFinite(actor.userData.heading)) actor.userData.heading = lalaHeading(lala, null, state.map.talk);
      animateActor(actor, false, time, gaze, false, dt, gaze);
      const line = state.lalaBubble;
      const lalaLine = line && line.until > performance.now() ? line.text : "";
      actor.userData.label = { title: lala.name || "Lala 小姐", subtitle: lala.title || "櫃檯", bubble: lalaLine };
    }
    const people = [];
    if (state.me) people.push({ ...state.me, moving: Boolean(state.walking) });
    for (const other of state.others?.values?.() || []) {
      const moving = Math.hypot((other.tx ?? other.x) - other.x, (other.ty ?? other.y) - other.y) > 1.5;
      people.push({ ...other, moving });
    }
    const bodies = [];
    if (state.map?.lala) {
      const lalaActor = actors.get("lala");
      if (lalaActor) bodies.push({ actor: lalaActor, x: lalaActor.position.x, z: lalaActor.position.z, r: bodyRadius(LALA_LOOK), pin: true });
    }
    for (const person of people) {
      const actor = ensureActor(person.id, person.look || FALLBACK_LOOK);
      keep.add(person.id);
      const prevX = actor.userData.px ?? person.x;
      const prevZ = actor.userData.pz ?? person.y;
      const dx = person.x - prevX;
      const dz = person.y - prevZ;
      const stepped = Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01;
      const mine = person.id === state.me?.id;
      const walking = Boolean(person.moving) && !person.seat;
      actor.userData.px = person.x;
      actor.userData.pz = person.y;
      actor.userData.sitting = Boolean(person.seat);
      let moveFace = Number.isFinite(person.face) ? person.face : (actor.userData.face ?? (person.dir === -1 ? Math.PI : 0));
      let gaze = null;
      let gazeRate = 3.4;
      if (mine) {
        if (!world.faceReady) {
          world.face = Number.isFinite(person.face) ? person.face : moveFace;
          world.faceReady = true;
          if (!Number.isFinite(actor.userData.heading)) actor.userData.heading = world.face;
        }
        const moving = Boolean(person.moving);
        world.walking = moving;
        if (moving && stepped) {
          moveFace = Math.atan2(dx, dz);
          world.face = moveFace;
        } else if (moving) {
          moveFace = world.face;
        } else if (world.mode !== "follow") {
          // Top-down view: keep the last walking direction instead of turning with the camera.
          gaze = world.face;
          gazeRate = 12;
          moveFace = world.face;
        } else if (Number.isFinite(world.heading)) {
          const turn = !person.seat && actor.userData.tasting ? 0 : Math.PI;
          moveFace = Math.atan2(Math.sin(world.heading + turn), Math.cos(world.heading + turn));
          gaze = moveFace;
          world.face = moveFace;
        } else {
          moveFace = Number.isFinite(actor.userData.heading) ? actor.userData.heading : world.face;
        }
        world.gazeAim = moveFace;
      } else if (walking && Number.isFinite(person.face)) {
        moveFace = person.face;
      } else if (walking && stepped) {
        moveFace = Math.atan2(dx, dz);
        actor.userData.face = moveFace;
      } else if (!walking && Number.isFinite(person.face)) {
        moveFace = person.face;
        gaze = person.face;
      }
      // Furniture rot is the facing yaw. 0 looks +Z (south). Sofas use this same yaw.
      if (person.seat) {
        const chair = (state.furniture || []).find((item) => item.id === person.seat);
        if (chair) {
          const deg = ((Number(chair.rot) || 0) % 360 + 360) % 360;
          const facing = (deg * Math.PI) / 180;
          moveFace = facing;
          gaze = null;
          if (mine) {
            world.face = facing;
            world.gazeAim = facing;
          }
        }
      }
      const stride = actor.userData.stride ?? 0;
      actor.userData.stride = stride + ((person.moving && !person.seat ? 1 : 0) - stride) * (1 - Math.exp(-12 * Math.max(0.001, dt)));
      const hop = person.seat ? 11 : Math.abs(Math.sin(time * 11)) * 3.5 * actor.userData.stride;
      const radius = bodyRadius(person.look);
      const pinned = person.id === state.me?.id;
      let rx = pinned ? person.x : (actor.userData.rx ?? person.x);
      let rz = pinned ? person.y : (actor.userData.rz ?? person.y);
      if (!pinned) {
        const follow = 1 - Math.exp(-10 * Math.max(0.001, dt));
        rx += (person.x - rx) * follow;
        rz += (person.y - rz) * follow;
      }
      actor.userData.rx = rx;
      actor.userData.rz = rz;
      bodies.push({ actor, x: rx, z: rz, r: radius, pin: pinned, hop });
      const bubble = visibleBubble(state, person.id);
      const glide = Boolean(person.seat) && Boolean(person.moving);
      animateActor(actor, (walking || glide) && gaze == null, time + (person.id || "").length, moveFace, Boolean(bubble.text), dt, gaze, gazeRate);
      if (mine) world.shown = actor.userData.heading;
      actor.userData.label = { title: person.displayName || person.id, subtitle: `@${person.id}`, bubble };
    }
    separateBodies(bodies);
    for (const body of bodies) {
      if (!body.hop && body.hop !== 0) continue;
      body.actor.position.set(body.x, body.hop, body.z);
      // Keep the contact blob on the floor while the body hops, shrinking a
      // touch at the top of each step. Seated actors keep it on the seat.
      const blob = body.actor.userData.shadow;
      if (blob) {
        const air = body.actor.userData.sitting ? 0 : body.hop;
        blob.position.y = SHADOW_Y - air / CREATURE;
        blob.scale.setScalar(1 - Math.min(0.2, air * 0.05));
      }
      body.actor.userData.rx = body.x;
      body.actor.userData.rz = body.z;
    }
    for (const [id, actor] of actors) {
      if (!keep.has(id)) {
        actorGroup.remove(actor);
        actors.delete(id);
        const floater = floaters.get(id);
        if (floater) {
          floater.remove();
          floaters.delete(id);
        }
      }
    }
    syncAuras(state);
  }

  function auraGeometries() {
    if (!auraDisc) {
      auraDisc = new THREE.CircleGeometry(22, 40);
      auraRing = new THREE.RingGeometry(16, 24, 40);
    }
    return { auraDisc, auraRing };
  }

  function syncAuras(state) {
    const want = new Set();
    const memberGroup = state.memberGroup;
    if (memberGroup) {
      for (const [id, group] of memberGroup) {
        const actor = actors.get(id);
        if (!actor) continue;
        want.add(id);
        let aura = auras.get(id);
        if (!aura) {
          const geos = auraGeometries();
          aura = new THREE.Group();
          const disc = new THREE.Mesh(geos.auraDisc, new THREE.MeshBasicMaterial({
            color: 0xe3c8fb,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: THREE.DoubleSide,
          }));
          const ring = new THREE.Mesh(geos.auraRing, new THREE.MeshBasicMaterial({
            color: 0xc084fc,
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
            side: THREE.DoubleSide,
          }));
          disc.rotation.x = -Math.PI / 2;
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.35;
          aura.add(disc, ring);
          actorGroup.add(aura);
          auras.set(id, aura);
        }
        if (aura.userData.group !== group) {
          aura.userData.group = group;
          let hash = 0;
          for (const char of group) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
          const hue = 0.72 + (hash % 18) / 180;
          aura.children[0].material.color.setHSL(hue, 0.55, 0.78);
          aura.children[1].material.color.setHSL(hue, 0.6, 0.62);
        }
        aura.position.set(actor.position.x, 1.2, actor.position.z);
      }
    }
    for (const [id, aura] of auras) {
      if (want.has(id)) continue;
      actorGroup.remove(aura);
      for (const child of aura.children) child.material.dispose();
      auras.delete(id);
    }
  }

  function visibleBubble(state, id) {
    const live = state.bubbles?.get?.(id);
    const theirGroup = state.memberGroup?.get?.(id);
    const inMine = Boolean(state.whisper && theirGroup === state.whisper);
    if (theirGroup && !inMine) return { text: "對話中…", kind: "secret" };
    if (live?.text && live.whisper && inMine) return { text: live.text, kind: "whisper" };
    if (live?.text && !live.whisper) return { text: live.text, kind: "" };
    return { text: "", kind: "" };
  }

  const crownBox = new THREE.Box3();
  const LABEL_GAP = 10;

  function crownWorldY(actor) {
    crownBox.setFromObject(actor);
    if (crownBox.isEmpty() || !Number.isFinite(crownBox.max.y)) return actor.position.y + 80;
    return crownBox.max.y;
  }

  function placeFloater(id, actor, title, subtitle, bubble) {
    if (!labels) return;
    let node = floaters.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "floater";
      node.innerHTML = '<div class="bubble"></div><div class="nametag"><b></b><small></small></div>';
      labels.appendChild(node);
      floaters.set(id, node);
    }
    node.dataset.id = id;
    node.querySelector("b").textContent = title || "";
    node.querySelector("small").textContent = subtitle || "";
    const info = bubble && typeof bubble === "object" ? bubble : { text: bubble || "", kind: "" };
    const bubbleNode = node.querySelector(".bubble");
    bubbleNode.hidden = !info.text;
    bubbleNode.classList.toggle("whisper", info.kind === "whisper");
    bubbleNode.classList.toggle("secret", info.kind === "secret");
    bubbleNode.replaceChildren();
    if (info.kind === "whisper") {
      const icon = document.createElement("span");
      icon.className = "shush";
      icon.textContent = "🔒";
      bubbleNode.append(icon, document.createTextNode(info.text));
    } else if (info.kind === "secret") {
      const label = document.createElement("span");
      label.textContent = "對話中…";
      const dots = document.createElement("i");
      dots.className = "dots";
      bubbleNode.append(label, dots);
    } else {
      bubbleNode.textContent = info.text || "";
    }
    if (!actor) {
      node.hidden = true;
      return;
    }
    projected.set(actor.position.x, crownWorldY(actor), actor.position.z);
    projected.project(camera);
    if (projected.z > 1) {
      node.hidden = true;
      return;
    }
    const rect = view.getBoundingClientRect();
    const host = labels.getBoundingClientRect();
    const sx = rect.left - host.left + (projected.x * 0.5 + 0.5) * rect.width;
    const headY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    node.dataset.crown = String(headY);
    let sy = headY - host.top - LABEL_GAP;
    node.hidden = false;
    if (phoneNow() && view.clientWidth > view.clientHeight) {
      const topbar = document.getElementById("topbar");
      if (topbar) {
        const limit = topbar.getBoundingClientRect().bottom + 4 - host.top;
        const stack = Math.max(node.offsetHeight, 28);
        const tagTop = sy - stack;
        if (tagTop < limit) sy += limit - tagTop;
      }
    }
    node.dataset.anchor = String(host.top + sy);
    node.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
  }

  function clearGroups() {
    for (const group of [floorGroup, wallGroup, propGroup]) group.clear();
    walls.length = 0;
    for (const actor of actors.values()) actorGroup.remove(actor);
    actors.clear();
    for (const node of floaters.values()) node.remove();
    floaters.clear();
    for (const aura of auras.values()) {
      actorGroup.remove(aura);
      for (const child of aura.children) child.material.dispose();
    }
    auras.clear();
    for (const mesh of furnMeshes.values()) furnGroup.remove(mesh);
    furnMeshes.clear();
  }

  function build(map) {
    clearGroups();
    buildFloor(map);
    buildWalls(map);
    buildProps(map);
    builtMap = map;
  }

  function syncFurniture(state) {
    const specs = state.specs;
    const list = state.furniture || [];
    const ids = new Set(list.map((item) => item.id));
    for (const [id, mesh] of furnMeshes) {
      if (!ids.has(id)) {
        furnGroup.remove(mesh);
        furnMeshes.delete(id);
      }
    }
    for (const item of list) {
      let mesh = furnMeshes.get(item.id);
      if (!mesh || mesh.userData.kind !== item.kind) {
        if (mesh) furnGroup.remove(mesh);
        mesh = makeFurniture(item);
        furnMeshes.set(item.id, mesh);
        furnGroup.add(mesh);
      }
      const size = itemSize(item, specs);
      const tx = item.x + size.w / 2;
      const tz = item.y + size.h / 2;
      const remoteRide = item.kind === "chair" && item.seat && item.seat !== state.me?.id;
      if (remoteRide) {
        const blend = 1 - Math.exp(-12 * Math.max(0.001, state.dt || 0.016));
        const sx = mesh.userData.sx ?? tx;
        const sz = mesh.userData.sz ?? tz;
        mesh.userData.sx = sx + (tx - sx) * blend;
        mesh.userData.sz = sz + (tz - sz) * blend;
        mesh.position.set(mesh.userData.sx, 0, mesh.userData.sz);
      } else {
        mesh.position.set(tx, 0, tz);
        mesh.userData.sx = tx;
        mesh.userData.sz = tz;
      }
      mesh.rotation.y = THREE.MathUtils.degToRad(item.rot || 0);
      mesh.userData.speed = item.speed || 0;
      if (mesh.userData.ring) {
        const selected = state.selected === item.id;
        mesh.userData.ring.visible = selected;
        if (selected) {
          const radius = Math.max(size.w, size.h) * 0.52;
          const scale = radius / 16;
          mesh.userData.ring.scale.set(scale, scale, 1);
        }
      }
    }
  }

  function reveal() {
    const roots = [];
    for (const group of [wallGroup, propGroup, furnGroup]) {
      for (const child of group.children) {
        if (child.userData.occlude) roots.push(child);
      }
    }
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const toCamX = camX - look.x;
    const toCamZ = camZ - look.z;
    const len = Math.hypot(toCamX, toCamZ) || 1;
    for (const wall of walls) {
      let scale = world.mode === "iso" ? 0.72 : 1;
      if (world.mode === "iso") {
        const x = clamp(look.x, wall.minX, wall.maxX);
        const z = clamp(look.z, wall.minZ, wall.maxZ);
        const along = ((x - look.x) * toCamX + (z - look.z) * toCamZ) / len;
        const side = Math.abs((x - look.x) * toCamZ - (z - look.z) * toCamX) / len;
        if (along > 24 && side < 90) scale = 0.08;
      }
      wall.mesh.scale.y = scale;
      wall.mesh.position.y = (wall.h * scale) / 2;
    }
    if (world.mode !== "follow") {
      for (const root of roots) setFade(root, false);
      return;
    }
    const faded = new Set();
    const chest = new THREE.Vector3(look.x, Math.max(18, look.y), look.z);
    const head = chest.clone();
    head.y += 22;
    for (const target of [chest, head]) {
      const delta = target.clone().sub(camera.position);
      const dist = delta.length();
      if (dist < 8) continue;
      raycaster.set(camera.position, delta.multiplyScalar(1 / dist));
      raycaster.near = 1;
      raycaster.far = dist - 8;
      const hits = raycaster.intersectObjects(roots, true);
      for (const hit of hits) {
        let node = hit.object;
        while (node && !node.userData?.occlude) node = node.parent;
        if (node) faded.add(node);
      }
    }
    for (const root of roots) setFade(root, faded.has(root));
  }

  function phoneNow() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function detectSoftware() {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl");
      if (!gl) return true;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      const cores = navigator.hardwareConcurrency || 4;
      return /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(gpu) || cores <= 2;
    } catch {
      return false;
    }
  }

  function qualityTier(glRenderer) {
    const phone = window.matchMedia("(max-width: 980px)").matches;
    const dpr = window.devicePixelRatio || 1;
    if (!world.software) {
      let gpu = "";
      try {
        const gl = glRenderer.getContext();
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
      } catch {
        gpu = "";
      }
      if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(gpu)) world.software = true;
    }
    if (phone || world.software) return "low";
    if (dpr < 1.25) return "mid";
    return "high";
  }

  function pixelCap(tier = world.quality) {
    const dpr = window.devicePixelRatio || 1;
    if (phoneNow() || tier === "low") return Math.min(phoneNow() ? 1.25 : 1, dpr);
    if (tier === "mid") return Math.min(1.25, dpr);
    return Math.min(1.5, dpr);
  }

  function ensureComposer(width, height) {
    if (world.quality === "low" || world.software || composer || !extrasMod) return;
    try {
      composer = new extrasMod.EffectComposer(renderer);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      const pass = new extrasMod.N8AOPass(scene, camera, Math.max(1, width), Math.max(1, height));
      pass.configuration.aoRadius = 34;
      pass.configuration.distanceFalloff = 0.9;
      pass.configuration.intensity = 2.3;
      pass.configuration.color = new THREE.Color(0x6b4638);
      pass.configuration.gammaCorrection = false;
      pass.configuration.halfRes = world.quality !== "high";
      pass.setQualityMode(world.quality === "high" ? "Low" : "Performance");
      composer.addPass(pass);
      composer.addPass(new extrasMod.OutputPass());
    } catch (error) {
      console.warn("ambient occlusion disabled", error);
      composer = null;
    }
  }

  function drawScene() {
    if (!composer) {
      renderer.render(scene, camera);
      return;
    }
    try {
      composer.render();
    } catch (error) {
      console.warn("ambient occlusion disabled", error);
      composer = null;
      renderer.render(scene, camera);
    }
  }

  function portraitPhone() {
    return phoneNow() && view.clientHeight > view.clientWidth;
  }

  function homeDist() {
    return portraitPhone() ? 800 : 500;
  }

  function frameForViewport() {
    if (world.mode !== "iso") return;
    if (world.dist === 500 || world.dist === 800 || world.dist === 1180 || (autoFrame && Math.abs(world.dist - autoFrame) < 1.5)) {
      world.dist = homeDist();
      autoFrame = 0;
    }
  }

  function screenY(x, y, z) {
    projected.set(x, y, z).project(camera);
    const rect = view.getBoundingClientRect();
    return rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
  }

  function releaseAutoFrame() {
    if (autoFrame && !world.userZoom && Math.abs(world.dist - autoFrame) < 1.5) world.dist = homeDist();
    autoFrame = 0;
  }

  function frameLandscape(state, chat) {
    const topbar = document.getElementById("topbar")?.getBoundingClientRect();
    const topLimit = (topbar ? topbar.bottom : 0) + 6;
    const bottomLimit = chat.getBoundingClientRect().top - 6;
    const band = bottomLimit - topLimit;
    const spots = [];
    const add = (id, x, z) => {
      const node = id ? floaters.get(id) : null;
      const anchor = Number(node?.dataset.anchor);
      const stack = node?.offsetHeight || node?.querySelector(".nametag")?.offsetHeight || 32;
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(anchor)) return;
      spots.push({ nameTop: anchor - stack, feet: screenY(x, 0, z) });
    };
    if (state?.me) add(state.me.id, state.me.x, state.me.y);
    if (state?.me && state.others?.values) {
      for (const person of state.others.values()) {
        if (Math.hypot(person.x - state.me.x, person.y - state.me.y) > 260) continue;
        add(person.id, person.x, person.y);
      }
    }
    if (!spots.length || band < 48) return;
    const nameTop = Math.min(...spots.map((spot) => spot.nameTop));
    const feet = Math.max(...spots.map((spot) => spot.feet));
    const span = feet - nameTop;
    if (!world.userZoom && span > band - 16 && world.dist < 1200) {
      const need = span / Math.max(80, band - 20);
      world.dist = Math.min(1200, world.dist * Math.min(1.18, Math.max(1.06, need)));
      if (Math.abs(world.dist - 1180) < 2) world.dist = 1184;
      autoFrame = world.dist;
    }
    const topOverlap = topLimit - nameTop;
    const bottomOverlap = feet - bottomLimit;
    let delta = 0;
    if (topOverlap > 3 && topOverlap >= bottomOverlap) delta = -Math.min(16, topOverlap * 0.45);
    else if (bottomOverlap > 3) delta = Math.min(16, bottomOverlap * 0.45);
    else {
      const shift = (topLimit + bottomLimit) / 2 - (nameTop + feet) / 2;
      if (Math.abs(shift) > 8) delta = -Math.sign(shift) * Math.min(8, Math.abs(shift) * 0.3);
    }
    chatLift = clamp(chatLift + delta, -360, 640);
  }

  function fitFog(dist) {
    if (!phoneNow()) {
      scene.fog.near = 2600;
      scene.fog.far = 5600;
      return;
    }
    const fogDist = Math.max(500, dist);
    scene.fog.near = fogDist * 1.6;
    scene.fog.far = fogDist * 4.8;
  }

  function updateChatLift(state) {
    const landscape = phoneNow() && view.clientWidth > view.clientHeight;
    const chat = document.getElementById("chatbar");
    const chatOpen = !!(chat && getComputedStyle(chat).display !== "none");
    if (!phoneNow() || world.mode !== "iso") {
      releaseAutoFrame();
      chatLift = Math.max(0, chatLift - 12);
      return;
    }
    if (landscape && chatOpen) {
      frameLandscape(state, chat);
      return;
    }
    releaseAutoFrame();
    const me = state?.me?.id ? floaters.get(state.me.id) : null;
    if (!me || me.hidden) {
      chatLift *= 0.7;
      return;
    }
    const box = me.getBoundingClientRect();
    const topbar = document.getElementById("topbar")?.getBoundingClientRect();
    const topLine = topbar ? topbar.bottom + 8 : 0;
    const topOverlap = topbar ? topLine - box.top : 0;
    let feetY = box.bottom;
    if (state.me) {
      projected.set(state.me.x, 0, state.me.y).project(camera);
      const rect = view.getBoundingClientRect();
      feetY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    }
    const bottomOverlap = chatOpen ? feetY - (chat.getBoundingClientRect().top - 10) : 0;
    const slack = topbar ? box.top - topLine : 80;
    let delta = 0;
    if (topOverlap > 4) delta = -Math.min(10, Math.max(0.8, topOverlap * 0.22));
    else if (bottomOverlap > 4 && slack > 12) delta = Math.min(10, bottomOverlap * 0.22, (slack - 8) * 0.35);
    else if (!chatOpen && topOverlap <= 0 && chatLift > 0.5) delta = -Math.min(6, chatLift * 0.35);
    else if (slack > 18 && bottomOverlap <= 0 && chatLift < -0.5) delta = Math.min(6, -chatLift * 0.35);
    chatLift = clamp(chatLift + delta, -240, 420);
  }

  function shadeActors() {
    const phone = phoneNow();
    sun.shadow.bias = phone ? -0.002 : -0.0004;
    // Toon steps make self-shadow acne stand out as ripples on the body.
    sun.shadow.normalBias = phone ? 4 : 0.9;
    setOutlineWidth(phone ? 0.85 : 1);
    actorGroup.traverse((node) => {
      if (!node.isMesh || node.material?.isMeshBasicMaterial) return;
      node.receiveShadow = !phone;
    });
  }

  function resize() {
    const width = Math.max(1, view.clientWidth);
    const height = Math.max(1, view.clientHeight);
    const phone = phoneNow();
    const ratio = pixelCap();
    world.pixelRatio = ratio;
    renderer.setPixelRatio(ratio);
    const shadow = shadowMap;
    if (sun.shadow.mapSize.x !== shadow) {
      sun.shadow.mapSize.set(shadow, shadow);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.needsUpdate = true;
    shadeActors();
    frameForViewport();
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
    } else {
      ensureComposer(width, height);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    syncPreviewSize();
  }

  function syncPreviewSize() {
    if (!previewRenderer || !preview || !previewCamera) return;
    const pw = Math.round(preview.clientWidth);
    const ph = Math.round(preview.clientHeight);
    if (pw < 2 || ph < 2) return;
    const cap = window.matchMedia("(max-width: 980px)").matches ? 1.25 : 1.5;
    const ratio = Math.min(cap, window.devicePixelRatio || 1);
    const aspect = pw / ph;
    const bw = Math.floor(pw * ratio);
    const bh = Math.floor(ph * ratio);
    if (preview.width === bw && preview.height === bh && Math.abs(previewCamera.aspect - aspect) < 0.001) return;
    previewRenderer.setPixelRatio(ratio);
    previewRenderer.setSize(pw, ph, false);
    previewCamera.aspect = aspect;
    previewCamera.updateProjectionMatrix();
    if (previewActor) previewActor.userData.framed = "";
  }

  let posed = world.mode;

  function behindYaw() {
    // Follow the eased body turn, not the raw step direction, so the camera never jitters.
    return (world.walking && Number.isFinite(world.shown) ? world.shown : world.face) + Math.PI;
  }

  function cameraYaw() {
    if (world.mode !== "follow") return world.yaw;
    if (world.steerHeld) return world.steerYaw;
    return Number.isFinite(world.camYaw) ? world.camYaw : behindYaw();
  }

  function holdSteer(held) {
    const now = performance.now();
    if (held) {
      if (!world.steerHeld) world.steerYaw = world.heading;
      world.steerHeld = true;
      world.steerUntil = now + 140;
      return;
    }
    if (world.steerHeld && now >= (world.steerUntil || 0)) world.steerHeld = false;
  }

  function placeCamera(dt) {
    const pitch = world.mode === "follow" ? world.followPitch : world.pitch;
    const dist = world.mode === "follow" ? world.followDist : world.dist;
    let yaw = world.yaw;
    if (world.mode === "follow") {
      const behind = behindYaw();
      if (!Number.isFinite(world.camYaw)) world.camYaw = behind;
      if (world.steerHeld) {
        yaw = world.steerYaw;
        world.camYaw = yaw;
      } else if (world.seated) {
        // Seated avatars keep facing the chair, so a dragged follow camera stays put.
        yaw = world.camYaw;
      } else {
        const delta = Math.atan2(Math.sin(behind - world.camYaw), Math.cos(behind - world.camYaw));
        world.camYaw += delta * (1 - Math.exp(-2.4 * Math.max(0.001, dt)));
        yaw = world.camYaw;
      }
    }
    const sinP = Math.sin(pitch);
    desired.set(
      look.x + dist * sinP * Math.sin(yaw),
      look.y + dist * Math.cos(pitch),
      look.z + dist * sinP * Math.cos(yaw),
    );
    const switched = posed !== world.mode;
    posed = world.mode;
    const blend = !snapped || switched ? 1 : 1 - Math.exp(-Math.max(0.001, dt) * 8);
    camera.position.lerp(desired, blend);
    const fov = world.mode === "follow" ? 48 : 40;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    world.heading = yaw;
    snapped = true;
    fitFog(dist + chatLift);
    const span = clamp(dist * 0.58, 260, 640);
    const shadowCam = sun.shadow.camera;
    if (Math.abs(shadowCam.right - span) > 12) {
      shadowCam.left = -span;
      shadowCam.right = span;
      shadowCam.top = span;
      shadowCam.bottom = -span;
      shadowCam.updateProjectionMatrix();
    }
    sun.position.set(look.x + 230, look.y + 400, look.z + 170);
    sun.target.position.set(look.x, 0, look.z);
    sun.target.updateMatrixWorld();
  }

  function syncStallDoors(state, dt) {
    const open = state?.stallOpen;
    if (!open || doorPivots.size === 0) return;
    const step = 1 - Math.exp(-8 * Math.max(0.001, dt || 0.016));
    for (const [id, pivot] of doorPivots) {
      const target = open.get(id) ? Math.PI / 2 : 0;
      pivot.rotation.y += (target - pivot.rotation.y) * step;
    }
  }

  function sync(state, dt) {
    if (!world.ok) return;
    if (state?.catalog?.radii) setRadii(state.catalog.radii);
    if (state.map && state.map !== builtMap) build(state.map);
    const focus = state.editing && state.focus ? state.focus : state.me;
    if (focus) {
      const height = world.mode === "follow" ? 46 : 8;
      const yawNow = cameraYaw();
      const next = new THREE.Vector3(
        focus.x + Math.sin(yawNow) * chatLift,
        height,
        focus.y + Math.cos(yawNow) * chatLift,
      );
      if (!snapped || posed !== world.mode) look.copy(next);
      else look.lerp(next, 1 - Math.exp(-Math.max(0.001, dt) * 8));
    }
    state.dt = dt || 0.016;
    world.seated = Boolean(state.me?.seat);
    syncFurniture(state);
    syncStallDoors(state, dt);
    spinChairs(performance.now() / 1000, state.dt);
    syncActors(state, performance.now() / 1000, dt || 0.016);
    if (toyHook?.frame) toyHook.frame(dt || 0.016, state);
    placeCamera(dt || 0.016);
    actorGroup.updateMatrixWorld(true);
    for (const [id, actor] of actors) {
      const label = actor.userData.label;
      if (label) placeFloater(id, actor, label.title, label.subtitle, label.bubble);
    }
    reveal();
    shadeActors();
    updateChatLift(state);
    drawScene();
    noteActor(state);
  }

  const probeFrustum = new THREE.Frustum();
  const probeProj = new THREE.Matrix4();

  function noteActor(state) {
    if (!world.capture || !state?.me?.id) return;
    const actor = actors.get(state.me.id);
    if (!actor) return;
    probeProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    probeFrustum.setFromProjectionMatrix(probeProj);
    let bodyIn = null;
    let shadowIn = null;
    let rigMiss = 0;
    let rigCount = 0;
    let sphereMiss = 0;
    actor.updateWorldMatrix(true, true);
    const bodyMesh = actor.userData.rig?.children?.find((node) => node.isMesh) || null;
    actor.traverse((node) => {
      if (!node.isMesh) return;
      const sphereHit = node.visible && probeFrustum.intersectsObject(node);
      const drawn = node.visible && (!node.frustumCulled || sphereHit);
      if (node === actor.userData.shadow) shadowIn = drawn;
      else {
        rigCount++;
        if (!drawn) rigMiss++;
        if (!sphereHit) sphereMiss++;
        if (node === bodyMesh) bodyIn = sphereHit;
      }
    });
    const center = bodyMesh?.geometry?.boundingSphere?.center;
    if (center) projected.copy(center).applyMatrix4(bodyMesh.matrixWorld);
    else projected.set(actor.position.x, 40, actor.position.z);
    projected.project(camera);
    const onScreen = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
    world.capture.push({
      bodyIn,
      shadowIn,
      rigMiss,
      rigCount,
      sphereMiss,
      onScreen,
      sy: Math.round((actor.userData.rig?.scale.y || 0) * 1000) / 1000,
      hop: Math.round(actor.position.y * 10) / 10,
      mode: world.mode,
      x: Math.round(actor.position.x),
      z: Math.round(actor.position.z),
      face: Math.round(world.face * 100) / 100,
      heading: Math.round(world.heading * 100) / 100,
    });
    if (world.capture.length > 360) world.capture.shift();
  }

  function spinChairs(time, dt) {
    for (const mesh of furnMeshes.values()) {
      if (mesh.userData.kind !== "chair") continue;
      const speed = mesh.userData.speed || 0;
      for (const wheel of mesh.userData.wheels || []) wheel.rotation.z += speed * dt * 0.09;
      const seat = mesh.userData.seatPivot;
      if (!seat) continue;
      if (speed > 36) mesh.userData.fast = true;
      if (mesh.userData.fast && speed < 14) {
        mesh.userData.wobble = Math.max(mesh.userData.wobble || 0, 0.16);
        mesh.userData.fast = false;
      }
      mesh.userData.wobble = (mesh.userData.wobble || 0) * Math.exp(-5.5 * dt);
      seat.rotation.x = Math.sin(time * 13) * (mesh.userData.wobble || 0);
    }
  }

  function renderPreview(look, time) {
    ensurePreview();
    if (!previewRenderer || !previewScene) return;
    const src = look && typeof look === "object" ? look : FALLBACK_LOOK;
    const sig = signature(src);
    if (!previewActor || previewActor.userData.sig !== sig) {
      if (previewActor) {
        previewActor.traverse((node) => {
          const material = node.material;
          if (!node.isMesh || !material) return;
          for (const shared of mats.values()) if (shared === material) return;
          material.dispose();
        });
        previewScene.remove(previewActor);
      }
      previewActor = creature(src);
      previewActor.traverse((node) => {
        const material = node.material;
        if (!node.isMesh || !material || material.isMeshBasicMaterial) return;
        node.material = new THREE.MeshBasicMaterial({
          color: material.color,
          side: material.side,
          vertexColors: material.vertexColors,
        });
      });
      previewActor.userData.sig = sig;
      previewActor.userData.faceCamera = false;
      previewScene.add(previewActor);
    }
    const spin = time || 0;
    animateActor(previewActor, false, spin, 0, false, 0.016);
    previewActor.rotation.y = Math.sin(spin * 0.8) * 0.22;
    previewActor.userData.heading = previewActor.rotation.y;
    previewActor.position.set(0, 0, 0);
    syncPreviewSize();
    const frameKey = `${sig}|${previewCamera.aspect.toFixed(3)}`;
    if (previewActor.userData.framed !== frameKey) {
      framePreview(previewActor);
      previewActor.userData.framed = frameKey;
    }
    previewRenderer.render(previewScene, previewCamera);
  }

  function framePreview(actor) {
    actor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(actor);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = (previewCamera.fov * Math.PI) / 180;
    const aspect = Math.max(0.2, previewCamera.aspect || 1);
    const margin = 1.35;
    const distY = (size.y * margin) / 2 / Math.tan(fov / 2);
    const distX = (Math.max(size.x, size.z) * margin) / 2 / Math.tan(fov / 2) / aspect;
    const dist = Math.max(distY, distX, 90);
    previewCamera.position.set(center.x + dist * 0.08, center.y + size.y * 0.08, center.z + dist);
    previewCamera.lookAt(center);
  }

  function screenToWorld(clientX, clientY) {
    const rect = view.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return { x: look.x, y: look.z };
    return { x: hit.x, y: hit.z };
  }

  function worldToScreen(x, y) {
    const rect = view.getBoundingClientRect();
    projected.set(x, 0, y).project(camera);
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  function orbit(dx, dy) {
    const turn = dx * 0.005;
    if (world.mode === "follow") {
      world.camYaw -= turn;
      if (world.steerHeld) world.steerYaw -= turn;
    } else world.yaw -= turn;
    tilt(dy);
  }

  function tilt(dy) {
    if (!Number.isFinite(dy)) return;
    if (world.mode === "follow") world.followPitch = clamp(world.followPitch - dy * 0.003, FOLLOW_PITCH - 0.09, FOLLOW_PITCH + 0.09);
    else world.pitch = clamp(world.pitch - dy * 0.003, 0.48, 1.02);
  }

  function aim(view = {}) {
    if (typeof view.yaw === "number") world.yaw = view.yaw;
    if (typeof view.pitch === "number") world.pitch = view.pitch;
    if (typeof view.dist === "number") {
      if (world.mode === "follow") world.followDist = view.dist;
      else world.dist = view.dist;
      world.userZoom = false;
      autoFrame = 0;
    }
  }

  function zoom(delta) {
    world.userZoom = true;
    const factor = Math.exp(delta * 0.0011);
    if (world.mode === "follow") world.followDist = clamp(world.followDist * factor, 140, 420);
    else world.dist = clamp(world.dist * factor, 280, 1400);
  }

  function toggle() {
    world.mode = world.mode === "iso" ? "follow" : "iso";
    if (world.mode === "follow") {
      world.camYaw = world.face + Math.PI;
      world.steerHeld = false;
    }
    return world.mode;
  }

  function axes() {
    const yaw = world.mode === "follow" && world.steerHeld ? world.steerYaw : world.heading;
    return {
      forwardX: -Math.sin(yaw),
      forwardY: -Math.cos(yaw),
      rightX: Math.cos(yaw),
      rightY: -Math.sin(yaw),
    };
  }

  resize();
  return {
    get ok() { return world.ok; },
    get previewOk() { return world.previewOk; },
    get mode() { return world.mode; },
    get yaw() { return world.yaw; },
    get shown() { return world.shown; },
    get gazeAim() { return world.gazeAim; },
    get cameraHeading() { return world.heading; },
    actorHeading(id) {
      const actor = actors.get(id);
      const heading = actor?.rotation?.y;
      return Number.isFinite(heading) ? heading : null;
    },
    forgetFace() { world.faceReady = false; },
    get pitch() { return world.mode === "follow" ? world.followPitch : world.pitch; },
    get dist() { return world.mode === "follow" ? world.followDist : world.dist; },
    get pixelRatio() { return world.pixelRatio; },
    get assetsReady() { return world.assetsReady === true; },
    get assetsProgress() { return library.progress; },
    get quality() { return world.quality; },
    homeDist,
    get fogNear() { return scene.fog.near; },
    aim,
    resize,
    sync,
    start,
    setRadii,
    preview: renderPreview,
    radius: bodyRadius,
    nudge,
    gap(a, b) {
      const left = actors.get(a);
      const right = actors.get(b);
      if (!left || !right) return null;
      return Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z);
    },
    orbit,
    zoom,
    toggle,
    axes,
    holdSteer,
    captureCount() { return world.capture?.length || 0; },
    beginCapture() { world.capture = []; },
    endCapture() {
      const data = world.capture || [];
      world.capture = null;
      return data;
    },
    screenToWorld,
    worldToScreen,
    setSnackHook(fn) { snackHook = typeof fn === "function" ? fn : null; },
    setStallHook(fn) { stallHook = typeof fn === "function" ? fn : null; },
    setToyHook(hooks) { toyHook = hooks && typeof hooks === "object" ? hooks : null; },
    /** Kenney model clone fitted to a box, or null while models are still loading. */
    model(name, w, h, opts) { return library.settled ? library.take(name, w, h, opts) : null; },
    get fx() { return fxGroup; },
    crown(id) {
      const actor = actors.get(id);
      return actor ? crownWorldY(actor) : null;
    },
    actor(id) { return actors.get(id) || null; },
  };
}

// Contact blob: solid core under the feet that fades out, so the base reads
// as grounded without a hard-edged disc.
function softBlob() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const fade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.5, "rgba(255,255,255,0.85)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

