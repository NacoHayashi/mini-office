import * as THREE from "./vendor/three.module.js";
import { outlineWidth, setOutlineWidth, stepGradient } from "./toon.js";
import { createAvatars } from "./avatar.js";
import { createMaterials } from "./world-materials.js";
import { createRooms } from "./world-rooms.js";
import { createProps } from "./world-props.js";
import { createLabels } from "./world-labels.js";
import { createActors } from "./world-actors.js";
import { createPreview } from "./world-preview.js";
import { createCamera } from "./world-camera.js";
import { createRedraw } from "./world-redraw.js";

export const TILE = 32;
export const WALL_H = 36;
export const WALL_T = 12;
const ISO_PITCH = 0.78;
export const FOLLOW_PITCH = Math.PI / 2 - (30 * Math.PI) / 180;
export const FALLBACK_LOOK = {
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

export function bodyRadius(look) {
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

export const LALA_LOOK = {
  ...FALLBACK_LOOK,
  head: "ribbon",
  colors: { ...FALLBACK_LOOK.colors, body: "#ff4d88", ear: "#ff4d88", tail: "#ff4d88", accessory: "#e85a6a" },
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createWorld({ view, preview, labels, fallback }) {
  let phoneMedia = null;
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
  // Shadows are redrawn only when something casting one moved (world-redraw.js).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xf8d0e2, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8d0e2);
  // world-redraw.js updates the matrices once per frame before deciding to draw.
  scene.matrixWorldAutoUpdate = false;
  scene.fog = new THREE.Fog(0xf6e6d4, 2600, 5600);
  let envMap = null;
  let extrasMod = null;
  const camera = new THREE.PerspectiveCamera(40, 1, 6, 4000);
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const projected = new THREE.Vector3();
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
  let composer = null;
  function currentEnvMap() {
    return envMap;
  }

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
          lightPreview(envMap);
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
    loadLibrary().ready.then(() => {
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
  const {
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
  } = createMaterials({ blobTexture, gradient, renderer, skinGradient });
  const { creature, paintFace, poseBody } = createAvatars({ mat, geo, addMesh, smoothSphere, blobTexture });
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
  const doorPivots = new Map();
  const floaters = new Map();
  const auras = new Map();
  let builtMap = null;
  let monitorHook = null;
  function setMonitorHook(fn) { monitorHook = typeof fn === "function" ? fn : null; }
  let meetingHook = null;
  function setMeetingHook(fn) { meetingHook = typeof fn === "function" ? fn : null; }
  const { buildFloor, buildWalls, textPlane } = createRooms({
    floorGroup,
    mat,
    patternTexture,
    roundedBox,
    wallGroup,
    walls,
    world,
  });
  const {
    buildProps,
    itemSize,
    libraryProgress,
    loadLibrary,
    makeFurniture,
    model,
    setStallHook,
  } = createProps({
    addMesh,
    contactShadow,
    doorPivots,
    geo,
    mat,
    propGroup,
    roundedBox,
    rugMesh,
    smoothSphere,
    textPlane,
  });
  const { beginFrame: beginLabels, crownWorldY, placeFloater, visibleBubble } = createLabels({ camera, floaters, labels, phoneNow, projected, view });
  const {
    animateActor,
    frameToys,
    nudge,
    setGymHook,
    setSnackHook,
    setToyHook,
    signature,
    syncActors,
  } = createActors({
    actorGroup,
    actors,
    auras,
    creature,
    floaters,
    paintFace,
    poseBody,
    visibleBubble,
    world,
  });
  const { lightPreview, renderPreview, syncPreviewSize } = createPreview({
    animateActor,
    creature,
    currentEnvMap,
    mats,
    preview,
    signature,
    world,
  });
  const {
    aim,
    axes,
    followFocus,
    frameForViewport,
    holdSteer,
    homeDist,
    orbit,
    placeCamera,
    screenToWorld,
    toggle,
    updateChatLift,
    worldToScreen,
    zoom,
  } = createCamera({
    camera,
    desired,
    floaters,
    floorPlane,
    hit,
    look,
    ndc,
    phoneNow,
    projected,
    raycaster,
    scene,
    sun,
    view,
    world,
  });
  const redraw = createRedraw({ actorGroup, camera, look, outlineWidth, renderer, scene, sun });
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
      setMonitorHook() {},
      setMeetingHook() {},
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

  const liveFurniture = new Set();
  function syncFurniture(state) {
    const specs = state.specs;
    const list = state.furniture || [];
    const ids = liveFurniture;
    ids.clear();
    for (const item of list) ids.add(item.id);
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

  function syncMonitors() {
    if (monitorHook) monitorHook(furnMeshes);
    if (meetingHook) meetingHook(furnMeshes, propGroup);
  }

  // Scratch objects reused every frame by reveal() (no per-frame garbage).
  const revealRoots = [];
  const revealFaded = new Set();
  const revealHits = [];
  const revealChest = new THREE.Vector3();
  const revealHead = new THREE.Vector3();
  const revealRay = new THREE.Vector3();
  function collectOccluders(group) {
    for (const child of group.children) {
      if (child.userData.occlude) revealRoots.push(child);
    }
  }

  function reveal() {
    const roots = revealRoots;
    roots.length = 0;
    collectOccluders(wallGroup);
    collectOccluders(propGroup);
    collectOccluders(furnGroup);
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
    const faded = revealFaded;
    faded.clear();
    revealChest.set(look.x, Math.max(18, look.y), look.z);
    revealHead.copy(revealChest);
    revealHead.y += 22;
    fadeBlockers(revealChest, roots, faded);
    fadeBlockers(revealHead, roots, faded);
    for (const root of roots) setFade(root, faded.has(root));
  }

  function fadeBlockers(target, roots, faded) {
    const delta = revealRay.copy(target).sub(camera.position);
    const dist = delta.length();
    if (dist < 8) return;
    raycaster.set(camera.position, delta.multiplyScalar(1 / dist));
    raycaster.near = 1;
    raycaster.far = dist - 8;
    revealHits.length = 0;
    raycaster.intersectObjects(roots, true, revealHits);
    for (const hit of revealHits) {
      let node = hit.object;
      while (node && !node.userData?.occlude) node = node.parent;
      if (node) faded.add(node);
    }
    revealHits.length = 0;
  }

  function phoneNow() {
    phoneMedia ||= window.matchMedia("(max-width: 980px)");
    return phoneMedia.matches;
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
    redraw.force();
  }
  function syncStallDoors(state, dt) {
    const open = state?.stallOpen;
    if (!open || doorPivots.size === 0) return;
    const step = 1 - Math.exp(-8 * Math.max(0.001, dt || 0.016));
    for (const [id, pivot] of doorPivots) {
      // Stall doors swing into the stall, along the west partition.
      const target = open.get(id) ? -Math.PI / 2 : 0;
      pivot.rotation.y += (target - pivot.rotation.y) * step;
    }
  }

  function sync(state, dt) {
    if (!world.ok) return;
    if (state?.catalog?.radii) setRadii(state.catalog.radii);
    if (state.map && state.map !== builtMap) build(state.map);
    const focus = state.editing && state.focus ? state.focus : state.me;
    if (focus) followFocus(focus, dt);
    state.dt = dt || 0.016;
    world.seated = Boolean(state.me?.seat);
    syncFurniture(state);
    syncMonitors();
    syncStallDoors(state, dt);
    spinChairs(performance.now() / 1000, state.dt);
    syncActors(state, performance.now() / 1000, dt || 0.016);
    frameToys(dt || 0.016, state);
    placeCamera(dt || 0.016);
    actorGroup.updateMatrixWorld(true);
    beginLabels();
    for (const [id, actor] of actors) {
      const label = actor.userData.label;
      if (label) placeFloater(id, actor, label.title, label.subtitle, label.bubble, label.hand);
    }
    reveal();
    shadeActors();
    updateChatLift(state);
    if (redraw.due(performance.now())) drawScene();
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
    get assetsProgress() { return libraryProgress(); },
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
    setMeetingHook,
    setMonitorHook,
    setSnackHook,
    setGymHook,
    setStallHook,
    setToyHook,
    model,
    get fx() { return fxGroup; },
    /** The placed group for the first decor piece using this model, or null while models load. */
    decor(name) { return propGroup.children.find((group) => group.userData.model === name && group.children.length) || null; },
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

