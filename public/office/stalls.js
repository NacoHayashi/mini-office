import * as THREE from "./vendor/three.module.js";
import { stepGradient } from "./toon.js";

// Keep in sync with STALL_REACH in src/stalls.ts.
const REACH = 42;
const ramp = stepGradient([176, 222, 255]);

function toon(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp });
}

// Kenney Furniture Kit (CC0, kenney.nl) has no urinal. This is a small custom
// bowl plus flush plate on the same toon palette, not a stack of boxes.
function buildUrinal(group) {
  const ceramic = toon(0xfffaf6);
  const lip = toon(0xf4ece4);
  const plateMat = toon(0xd5d0c8);
  const drainMat = toon(0xc5c0d4);
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(7.2, 6.4, 20, 20, 1, true, Math.PI * 1.15, Math.PI * 0.7),
    ceramic,
  );
  shell.position.set(-2, 18, 0);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(6.4, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.48), ceramic);
  bowl.scale.set(0.72, 0.5, 1.05);
  bowl.position.set(2.4, 11, 0);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  group.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.55, 8, 20, Math.PI), lip);
  rim.rotation.z = Math.PI / 2;
  rim.rotation.y = Math.PI / 2;
  rim.position.set(2.2, 12.4, 0);
  group.add(rim);
  const drain = new THREE.Mesh(new THREE.CircleGeometry(1.1, 14), drainMat);
  drain.rotation.y = Math.PI / 2;
  drain.position.set(3.6, 9.2, 0);
  group.add(drain);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.45, 16), plateMat);
  plate.rotation.z = Math.PI / 2;
  plate.position.set(-1.2, 27.5, 0);
  group.add(plate);
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), toon(0xf7c6d4));
  button.position.set(0.4, 27.5, 0);
  group.add(button);
}

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
      if (!material || (material.name !== "wood" && material.name !== "_defaultMat")) return;
      material.color.copy(color);
    });
  };
}

function buildStall(prop, group, api) {
  if (prop.kind === "urinal") {
    buildUrinal(group);
    return true;
  }
  if (prop.kind === "stallwall") {
    const model = api.take("wall", prop.h, prop.w, { maxHeight: 48, stretch: 8, yaw: Math.PI / 2 });
    if (!model) return false;
    group.add(model);
    tintWall(group, prop.tint);
    return true;
  }
  if (prop.kind === "toilet") {
    const model = api.take("toilet", prop.w, prop.h, { maxHeight: 28, stretch: 4 });
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
    return doors().map((prop) => ({ id: prop.id, room: prop.room, open: isOpen(prop.id) }));
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
