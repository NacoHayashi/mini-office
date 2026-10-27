import * as THREE from "./vendor/three.module.js";

// Keep in sync with STALL_REACH in src/stalls.ts.
const REACH = 60;

function swingDoor(group, wrap) {
  group.updateMatrixWorld(true);
  let door = null;
  wrap.traverse((node) => {
    if (node.name === "door") door = node;
  });
  if (!door) return;
  const box = new THREE.Box3().setFromObject(door);
  const hinge = new THREE.Vector3(box.min.x, 0, (box.min.z + box.max.z) / 2);
  const pivot = new THREE.Group();
  pivot.position.copy(hinge);
  group.add(pivot);
  pivot.attach(door);
  group.userData.doorPivot = pivot;
}

function tintWall(group, tint) {
  if (!tint) return;
  group.userData.paint = () => {
    const color = new THREE.Color(tint);
    group.traverse((node) => {
      if (!node.isMesh || node.userData.outline) return;
      const material = node.material;
      if (!material) return;
      // Bubbly Bathroom look: tinted panels over a white tiled base.
      if (material.name === "metalDark") material.color.setHex(0xfffaf2);
      else if (material.name === "wood" || material.name === "_defaultMat") material.color.copy(color);
    });
  };
}

function buildStall(prop, group, api) {
  if (prop.kind === "stallwall") {
    const model = api.take("wall", prop.h, prop.w, { maxHeight: 48, stretch: 8, yaw: Math.PI / 2 });
    if (!model) return false;
    group.add(model);
    tintWall(group, prop.tint);
    return true;
  }
  if (prop.kind === "toilet") {
    // Bubbly Bathroom toilet (Tiny Treats, CC0); its tank sits against the back wall.
    const model = api.take("bath-toilet", prop.w, prop.h, { maxHeight: 30, stretch: 1.3, yaw: Math.PI });
    if (!model) return false;
    group.add(model);
    return true;
  }
  if (prop.kind === "stalldoor") {
    const model = api.take("doorway", prop.w, prop.h, { maxHeight: 48, stretch: 6 });
    if (!model) return false;
    group.add(model);
    swingDoor(group, model);
    return true;
  }
  return false;
}

function closedBox(prop) {
  return { x: prop.x, y: prop.y, w: prop.w, h: prop.h };
}

export function attachStalls(env) {
  const { state, world, send } = env;
  const open = new Map();
  state.stallOpen = open;
  let note = null;

  function isOpen(id) {
    return open.get(id) === true;
  }

  function box(prop) {
    if (prop?.kind === "stalldoor" && isOpen(prop.id) && Number.isFinite(prop.openX)) {
      return { x: prop.openX, y: prop.openY, w: prop.openW, h: prop.openH };
    }
    return closedBox(prop);
  }

  function doors() {
    return (state.map?.props || []).filter((prop) => prop.kind === "stalldoor");
  }

  function nearest() {
    const me = state.me;
    if (!me || state.seat) return null;
    let best = null;
    for (const prop of doors()) {
      const spot = closedBox(prop);
      const nx = Math.max(spot.x, Math.min(me.x, spot.x + spot.w));
      const ny = Math.max(spot.y, Math.min(me.y, spot.y + spot.h));
      const dist = Math.hypot(me.x - nx, me.y - ny);
      if (dist <= REACH && (!best || dist < best.dist)) best = { prop, dist };
    }
    return best;
  }

  function prompt() {
    const near = nearest();
    if (!near) return "";
    if (note && note.id === near.prop.id && note.until > performance.now()) return note.text;
    return isOpen(near.prop.id) ? "按 E 關門" : "按 E 開門";
  }

  function toggle() {
    const near = nearest();
    if (!near || state.socket?.readyState !== 1) return false;
    send({ t: "stall", id: near.prop.id });
    return true;
  }

  function apply(list) {
    open.clear();
    if (!Array.isArray(list)) return;
    for (const door of list) {
      if (!door || typeof door.id !== "string") continue;
      open.set(door.id, door.open === true);
    }
  }

  function onNet(message) {
    if (!message) return;
    if (message.t === "welcome" || message.t === "stalls") {
      note = null;
      apply(message.doors);
    }
    if (message.t === "error" && typeof message.stall === "string") {
      note = { id: message.stall, text: message.message || "沒有成功", until: performance.now() + 2400 };
    }
  }

  function view() {
    return doors().map((prop) => ({ id: prop.id, open: isOpen(prop.id) }));
  }

  function action() {
    const near = nearest();
    if (!near) return null;
    const label = isOpen(near.prop.id) ? "關門" : "開門";
    return { id: "stall", label, run: toggle };
  }

  world.setStallHook?.((prop, group, api) => buildStall(prop, group, api));

  return { box, nearest, prompt, toggle, onNet, view, action, isOpen };
}
