import * as THREE from "./vendor/three.module.js";
import { stepGradient } from "./toon.js";

// Same reach rules as the server; the server has the final say.
const RACK_REACH = 108;
const PICK_REACH = 60;
const HIT_GAP = 34;
const RAM_GAP = 22;
const THROW_REACH = 320;
const CATCH_OPEN_MS = 200;
const CATCH_GRACE_MS = 450;
const RAM_COOL_MS = 3000;
const BUMP_COOL_MS = 2500;
const HEAR = 560;
const RANGE = { bubble: 260, wand: 260, water: 300 };

const PASTEL = { pink: 0xffa8c8, peach: 0xffc6a0, butter: 0xffe48a, mint: 0xa6e8cf, sky: 0x9fd4ff, lilac: 0xcdb4ff, cream: 0xfffdf6 };
const gradient = stepGradient([176, 222, 255]);

function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
}

function part(geometry, color, extra) {
  const mesh = new THREE.Mesh(geometry, toon(color, extra));
  mesh.userData.own = true;
  return mesh;
}

/** Turns a shape built along +y so it points along +z (forward). */
function forward(mesh) {
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// ---- procedural toy models (toon, pastel, no outlines) -----------------------
// Each is built with the grip at the origin and the business end toward +z or +y.

// An inflatable squeaky hammer: a fat rounded pink head with white bands, a butter handle.
function squeakyHammer() {
  const group = new THREE.Group();
  const handle = part(new THREE.CylinderGeometry(0.95, 1.1, 12, 12), PASTEL.butter);
  handle.position.y = 4;
  const knob = part(new THREE.SphereGeometry(1.4, 12, 10), PASTEL.peach);
  knob.position.y = -2.2;
  const head = part(new THREE.CapsuleGeometry(3.5, 6.5, 8, 16), PASTEL.pink);
  head.rotation.z = Math.PI / 2;
  head.position.y = 12.6;
  head.userData.part = "head";
  group.add(handle, knob, head);
  for (const side of [-1, 1]) {
    const band = part(new THREE.TorusGeometry(3.5, 0.6, 8, 20), PASTEL.cream);
    band.rotation.y = Math.PI / 2;
    band.position.set(side * 3.1, 12.6, 0);
    const face = part(new THREE.SphereGeometry(1.5, 12, 8), PASTEL.cream);
    face.scale.set(0.35, 1, 1);
    face.position.set(side * 6.75, 12.6, 0);
    group.add(band, face);
  }
  return group;
}

// A pastel beach ball: six soft colour gores with white caps.
function beachBall() {
  const geometry = new THREE.SphereGeometry(5, 24, 16).toNonIndexed();
  const colors = [PASTEL.pink, PASTEL.cream, PASTEL.sky, PASTEL.cream, PASTEL.butter, PASTEL.cream].map((hex) => new THREE.Color(hex));
  const cap = new THREE.Color(PASTEL.mint);
  const pos = geometry.attributes.position;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const angle = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
    const color = Math.abs(y) > 4.3 ? cap : colors[Math.floor(angle * 6) % 6];
    for (let k = 0; k < 3; k++) out.set([color.r, color.g, color.b], (i + k) * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(out, 3));
  const ball = new THREE.Mesh(geometry, toon(0xffffff, { vertexColors: true }));
  ball.userData.own = true;
  ball.position.y = 5;
  const group = new THREE.Group();
  group.add(ball);
  return group;
}

function bubbleGun() {
  const group = new THREE.Group();
  const grip = part(new THREE.CylinderGeometry(1.1, 1.3, 5, 10), PASTEL.lilac);
  grip.position.set(0, 1.8, -1);
  grip.rotation.x = -0.25;
  const body = forward(part(new THREE.CapsuleGeometry(2, 5, 6, 12), PASTEL.mint));
  body.position.set(0, 5, 1);
  const ring = part(new THREE.TorusGeometry(1.9, 0.5, 8, 18), PASTEL.pink);
  ring.position.set(0, 5, 5.8);
  const bottle = part(new THREE.SphereGeometry(2, 14, 10), PASTEL.sky, { transparent: true, opacity: 0.7 });
  bottle.position.set(0, 8, 0);
  group.add(grip, body, ring, bottle);
  return group;
}

// A chunky oversized water blaster with a see-through tank.
function waterGun() {
  const group = new THREE.Group();
  const grip = part(new THREE.CylinderGeometry(1.3, 1.5, 6, 10), PASTEL.lilac);
  grip.position.set(0, 2.6, -3);
  grip.rotation.x = -0.2;
  const body = forward(part(new THREE.CapsuleGeometry(2.6, 11, 6, 14), PASTEL.peach));
  body.position.set(0, 6.4, 2);
  const barrel = forward(part(new THREE.CylinderGeometry(0.9, 1.1, 5, 10), PASTEL.butter));
  barrel.position.set(0, 6.8, 10.5);
  const pump = forward(part(new THREE.CylinderGeometry(1.3, 1.3, 4.5, 10), PASTEL.pink));
  pump.position.set(0, 3.6, 6.5);
  const tank = forward(part(new THREE.CapsuleGeometry(2.2, 5, 6, 12), PASTEL.sky, { transparent: true, opacity: 0.75 }));
  tank.position.set(0, 10.2, -0.5);
  group.add(grip, body, barrel, pump, tank);
  return group;
}

function starShape(outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

function magicWand() {
  const group = new THREE.Group();
  const stick = part(new THREE.CylinderGeometry(0.45, 0.55, 12, 10), PASTEL.cream);
  stick.position.y = 5;
  const star = part(new THREE.ExtrudeGeometry(starShape(3.2, 1.4), { depth: 1, bevelEnabled: true, bevelSize: 0.4, bevelThickness: 0.4, bevelSegments: 2 }), PASTEL.butter);
  star.position.set(0, 13.2, -0.5);
  const gem = part(new THREE.SphereGeometry(0.9, 10, 8), PASTEL.pink);
  gem.position.set(0, 13.2, 0.9);
  const ribbon = part(new THREE.TorusGeometry(0.9, 0.3, 6, 12), PASTEL.lilac);
  ribbon.rotation.x = Math.PI / 2;
  ribbon.position.y = 10.4;
  group.add(stick, star, gem, ribbon);
  return group;
}

const ITEMS = [
  { id: "hammer", label: "嗶嗶槌", build: squeakyHammer, hand: [9, 13, 6], rack: [11, 12, 7] },
  { id: "ball", label: "沙灘球", build: beachBall, hand: [7, 7, 7], rack: [9, 9, 9] },
  { id: "pillow", label: "枕頭", model: "pillow", hand: [10, 8, 5], rack: [11, 9, 6] },
  { id: "bubble", label: "泡泡槍", build: bubbleGun, hand: [5, 7, 7], rack: [7, 9, 9] },
  { id: "water", label: "大水槍", build: waterGun, hand: [6, 9, 12], rack: [7, 10, 11] },
  { id: "wand", label: "魔法棒", build: magicWand, hand: [5, 11, 3], rack: [7, 13, 4] },
  { id: "ram", label: "撞撞車", model: "vehicle-racer", hand: [5, 6, 8], rack: [8, 12, 6] },
];
const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

/** Scales a procedural toy to fit its box. Held toys keep the grip at the origin. */
function fitInto(node, size, inHand) {
  const box = new THREE.Box3().setFromObject(node);
  const dim = box.getSize(new THREE.Vector3());
  const scale = Math.min(size[0] / Math.max(dim.x, 0.01), size[1] / Math.max(dim.y, 0.01), size[2] / Math.max(dim.z, 0.01));
  node.scale.setScalar(scale);
  if (!inHand) {
    const mid = box.getCenter(new THREE.Vector3());
    node.position.set(-mid.x * scale, -box.min.y * scale, -mid.z * scale);
  }
}

// Kenney clones share geometry and materials with the loaded templates, so only
// meshes made here are disposed.
function disposeTree(node) {
  if (!node) return;
  node.removeFromParent();
  node.traverse((child) => {
    if (!child.userData?.own) return;
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  });
}

function hidePockets(actor) {
  const hidden = [];
  actor.traverse((node) => {
    if (!node.userData?.held && !node.userData?.pocket) return;
    if (!node.visible) return;
    node.visible = false;
    hidden.push(node);
  });
  return hidden;
}

function showPockets(hidden) {
  for (const node of hidden || []) if (node.parent) node.visible = true;
}

function starTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffd75e";
  ctx.strokeStyle = "#fff6c8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 28;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Damped spring from 1 toward 0 that overshoots: mochi squash, rebound, settle.
function spring(t, rate = 6, freq = 14) {
  return Math.exp(-rate * t) * Math.cos(freq * t);
}

function ease(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

export function attachToys(env) {
  const { state, world, $, send, sizeOf } = env;
  const places = new Map(ITEMS.map((item) => [item.id, { at: "rack" }]));
  const held = new Map();
  const effects = new Map();
  const particles = [];
  const flights = [];
  let combo = 0;
  let incoming = null;
  let pinching = null;
  let ramAt = 0;
  let bumpAt = 0;
  let menu = null;
  let near = null;
  let openedAt = 0;
  let placedSig = "";
  let placed = [];
  let stars = null;
  let audio = null;
  let pace = { x: 0, y: 0, at: 0, speed: 0 };
  const log = [];

  // ---- state -------------------------------------------------------------

  function applyView(message) {
    if (!Array.isArray(message.toys)) return;
    for (const row of message.toys) {
      if (!row || !BY_ID.has(row.id)) continue;
      if (row.at === "hand" && typeof row.holder === "string") places.set(row.id, { at: "hand", holder: row.holder });
      else if (row.at === "floor" && Number.isFinite(row.x) && Number.isFinite(row.y)) places.set(row.id, { at: "floor", x: row.x, y: row.y });
      else if (row.at === "air") places.set(row.id, { at: "air" });
      else places.set(row.id, { at: "rack" });
    }
    if (typeof message.combo === "number") combo = message.combo;
    if (menu && !menu.hidden) paintMenu();
  }

  function holding(id = state.me?.id) {
    if (!id) return "";
    for (const [toy, place] of places) if (place.at === "hand" && place.holder === id) return toy;
    return "";
  }

  function rack() {
    const item = (state.furniture || []).find((row) => row.kind === "toyrack");
    if (!item) return null;
    const size = sizeOf(item);
    return { item, x: item.x + size.w / 2, y: item.y + size.h / 2, w: size.w, h: size.h, standX: item.x + size.w / 2, standY: item.y + size.h + 30 };
  }

  function nearRack() {
    const spot = rack();
    if (!spot || !state.me) return null;
    return Math.hypot(state.me.x - spot.x, state.me.y - spot.y) < RACK_REACH ? spot : null;
  }

  function floorNear() {
    if (!state.me) return null;
    let best = null;
    for (const [id, place] of places) {
      if (place.at !== "floor") continue;
      const dist = Math.hypot(state.me.x - place.x, state.me.y - place.y);
      if (dist < PICK_REACH && (!best || dist < best.dist)) best = { id, dist };
    }
    return best;
  }

  /** Toys Lala can put away: on the floor, or still in the hand of someone who left. */
  function messy() {
    let count = 0;
    for (const [, place] of places) {
      if (place.at === "floor") count += 1;
      else if (place.at === "hand" && place.holder !== state.me?.id && !state.others.has(place.holder)) count += 1;
    }
    return count;
  }

  function touch(person) {
    return env.bodyRadius(state.me?.look) + env.bodyRadius(person.look) + HIT_GAP;
  }

  function reachFor(toy, person) {
    if (toy === "ball") return THROW_REACH;
    if (toy === "ram") return env.bodyRadius(state.me?.look) + env.bodyRadius(person.look) + RAM_GAP;
    return RANGE[toy] ?? touch(person);
  }

  function closest(reach) {
    if (!state.me) return null;
    let best = null;
    for (const person of state.others.values()) {
      const dist = Math.hypot(state.me.x - person.x, state.me.y - person.y);
      if (dist > reach(person)) continue;
      if (!best || dist < best.dist) best = { person, dist };
    }
    return best?.person || null;
  }

  function target(toy = holding()) {
    if (!state.me || !toy) return null;
    return closest((person) => reachFor(toy, person));
  }

  /** The coworker close enough to bump or pinch, no toy needed. */
  function closeBy() {
    if (!state.me || state.seat) return null;
    return closest(touch);
  }

  function emote(id, text, ms = 1800) {
    state.bubbles.set(id, { text, until: performance.now() + ms, emote: true });
  }

  function heard(id) {
    const actor = world.actor?.(id);
    if (!actor || !state.me) return false;
    return Math.hypot(actor.position.x - state.me.x, actor.position.z - state.me.y) < HEAR;
  }

  // ---- sound (WebAudio synth) ---------------------------------------------

  function voice() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      return audio;
    } catch {
      return null;
    }
  }

  function chirp(ctx, type, from, to, length, volume, delay = 0) {
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  function puff(ctx, length, volume) {
    const frames = Math.floor(ctx.sampleRate * length);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }

  function sound(kind) {
    const ctx = voice();
    if (!ctx) return;
    try {
      if (kind === "squeak") {
        // 「嗶」: the squeaky hammer's toy whistle, plus a soft bonk underneath.
        chirp(ctx, "square", 1250, 1700, 0.09, 0.07);
        chirp(ctx, "square", 1700, 1100, 0.12, 0.06, 0.08);
        chirp(ctx, "sine", 520, 160, 0.16, 0.24);
      } else if (kind === "pillow") puff(ctx, 0.22, 0.4);
      else if (kind === "catch") chirp(ctx, "square", 520, 880, 0.08, 0.08);
      else if (kind === "throw") chirp(ctx, "sine", 300, 620, 0.14, 0.12);
      else if (kind === "boing") {
        chirp(ctx, "sine", 240, 520, 0.12, 0.22);
        chirp(ctx, "sine", 520, 260, 0.2, 0.16, 0.12);
      } else if (kind === "pinch") chirp(ctx, "sine", 600, 900, 0.12, 0.1);
      else if (kind === "bubble") for (let i = 0; i < 4; i++) chirp(ctx, "sine", 700 + i * 120, 1300 + i * 90, 0.07, 0.07, i * 0.09);
      else if (kind === "water") puff(ctx, 0.45, 0.22);
      else if (kind === "wand") for (let i = 0; i < 5; i++) chirp(ctx, "sine", 900 + i * 220, 1100 + i * 220, 0.12, 0.06, i * 0.06);
    } catch {
      /* audio is optional */
    }
  }

  // ---- held props ---------------------------------------------------------

  function makeProp(item, size, inHand = false) {
    let inner;
    if (item.build) {
      inner = item.build();
      fitInto(inner, size, inHand);
    } else {
      inner = world.model?.(item.model, size[0], size[2], { maxHeight: size[1], stretch: 1.1 });
      if (!inner) return null;
    }
    const group = new THREE.Group();
    group.add(inner);
    return group;
  }

  function release(actor, pose) {
    showPockets(pose.hidden);
    disposeTree(pose.prop);
    const arm = actor?.userData?.armR;
    if (arm && pose.rest) arm.position.set(pose.rest.x, pose.rest.y, pose.rest.z);
  }

  function bindHeld(actor, id) {
    const toy = holding(id);
    let pose = held.get(id);
    if (pose && (pose.toy !== toy || pose.actor !== actor)) {
      release(pose.actor, pose);
      held.delete(id);
      pose = null;
    }
    if (!toy) return null;
    if (!pose) {
      const arm = actor.userData.armR;
      if (!arm) return null;
      pose = { toy, actor, prop: null, hidden: hidePockets(actor), rest: { x: arm.position.x, y: arm.position.y, z: arm.position.z } };
      held.set(id, pose);
    }
    if (!pose.prop) {
      pose.prop = makeProp(BY_ID.get(toy), BY_ID.get(toy).hand, true);
      if (pose.prop) actor.userData.armR.add(pose.prop);
    }
    return pose;
  }

  const HOLD = {
    hammer: [[1.6, 0, 1.2], [0.25, 0, -0.3]],
    ball: [[1.8, 2, 2.2], [0, 0, 0]],
    bubble: [[1.6, -0.6, 1.2], [0, 0, 0]],
    water: [[1.6, -1, 0.4], [0, 0, 0]],
    wand: [[1.6, 0, 1], [0.3, 0, -0.15]],
    ram: [[2.2, 1.6, 0.8], [0, Math.PI / 2, 0]],
  };

  function placeHeld(actor, pose, now) {
    const arm = actor.userData.armR;
    if (!arm || !pose.rest) return;
    arm.position.set(pose.rest.x + 2.4, pose.rest.y + 4.2, pose.rest.z + 0.4);
    const prop = pose.prop;
    if (!prop) return;
    const [at, turn] = HOLD[pose.toy] || [[2.2, 1.6, 0.8], [0, 0, 0]];
    prop.position.set(at[0], at[1], at[2]);
    prop.rotation.set(turn[0], turn[1], turn[2]);
    const fx = effects.get(pose.actor.userData.pid);
    const swing = fx?.swing;
    if (!swing) return;
    const t = (now - swing.t0) / 1000;
    if (t > 0.45) {
      fx.swing = null;
      return;
    }
    // Wind up, then a quick bonk forward.
    const lift = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.3);
    if (pose.toy === "hammer" || pose.toy === "pillow" || pose.toy === "wand") {
      arm.position.y += lift * 5;
      arm.position.z += lift * 3;
      if (pose.toy === "pillow") prop.rotation.z += 0.8 * lift;
      else prop.rotation.x += t < 0.15 ? -1.4 * lift : 1.2 * lift;
    } else {
      // Aim forward with a small recoil.
      arm.position.z += 2 * lift;
      prop.rotation.x -= 0.25 * lift;
    }
  }

  // ---- per-actor effects ---------------------------------------------------

  function fxOf(id) {
    let fx = effects.get(id);
    if (!fx) {
      fx = {};
      effects.set(id, fx);
    }
    return fx;
  }

  function actorHook(actor, info) {
    const id = actor.userData?.pid;
    if (!id) return;
    const now = performance.now();
    const pose = bindHeld(actor, id);
    if (pose) placeHeld(actor, pose, now);
    const fx = effects.get(id);
    const rig = actor.userData.rig;
    if (!rig) return;
    rig.position.y = 0;
    rig.rotation.z = 0;
    if (!fx) return;
    const lift = 1 / (actor.scale.y || 1);
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (fx.squash) {
      const t = (now - fx.squash) / 1000;
      if (t > 1.4) fx.squash = 0;
      else if (t >= 0) {
        // Flatten fast, stay pressed for a beat like mochi, then spring back past round and settle.
        const s = t < 0.3 ? ease(t / 0.05) : spring(t - 0.3, 5.5, 15);
        sy *= 1 - 0.42 * s;
        sx *= 1 + 0.3 * s;
        sz *= 1 + 0.3 * s;
        fx.low = Math.min(fx.low ?? 1, sy);
      }
    }
    if (fx.wobble) {
      const t = (now - fx.wobble) / 1000;
      if (t > 1.2) fx.wobble = 0;
      else if (t >= 0) rig.rotation.z += 0.32 * Math.exp(-3.6 * t) * Math.sin(t * 19);
    }
    if (fx.shake) {
      // Shaking off water: quick side-to-side shivers.
      const t = (now - fx.shake) / 1000;
      if (t > 1.1) fx.shake = 0;
      else if (t >= 0) {
        rig.rotation.z += 0.12 * Math.sin(t * 48) * (1 - t / 1.1);
        sx *= 1 + 0.04 * Math.sin(t * 48);
      }
    }
    if (fx.float) {
      // Lifted by bubbles: drift up, bob, drift down.
      const t = (now - fx.float) / 1000;
      if (t > 2.4) fx.float = 0;
      else if (t >= 0) rig.position.y += (10 * Math.sin((Math.PI * t) / 2.4) + Math.sin(t * 6) * 1.2) * lift;
    }
    if (fx.tiny) {
      // The wand shrinks them for a moment, then they pop back with a spring.
      const t = (now - fx.tiny) / 1000;
      if (t > 2.6) fx.tiny = 0;
      else if (t >= 0) {
        const k = t < 0.25 ? ease(t / 0.25) : t < 1.6 ? 1 : spring(t - 1.6, 5, 16);
        const f = 1 - 0.45 * k;
        sx *= f;
        sy *= f;
        sz *= f;
        fx.small = Math.min(fx.small ?? 1, f);
      }
    }
    if (fx.pinch) {
      const p = fx.pinch;
      if (p.on && now > p.until) {
        p.on = false;
        p.off = now;
      }
      if (p.on) {
        const grip = ease((now - p.t0) / 250);
        const jiggle = Math.sin(now / 55) * 0.025 * grip;
        sx *= 1 + 0.34 * grip + jiggle;
        sy *= 1 - 0.07 * grip;
      } else {
        const t = (now - p.off) / 1000;
        if (t > 0.9) fx.pinch = null;
        else sx *= 1 + 0.34 * spring(t, 7, 17);
      }
    }
    if (fx.pinchBy) {
      const p = fx.pinchBy;
      if (now > p.until) fx.pinchBy = null;
      else {
        const arms = [actor.userData.armL, actor.userData.armR];
        for (const arm of arms) if (arm) arm.position.z += 4;
      }
    }
    if (fx.spin) {
      const t = (now - fx.spin) / 1000;
      if (t > 0.75) fx.spin = 0;
      else {
        actor.rotation.y += Math.PI * 2 * ease(t / 0.6);
        // Up in an arc, land, one small bounce.
        if (t < 0.45) rig.position.y = 16 * Math.sin((Math.PI * t) / 0.45) * lift;
        else if (t < 0.7) rig.position.y = 4.5 * Math.sin((Math.PI * (t - 0.45)) / 0.25) * lift;
        if (t > 0.42 && t < 0.56) {
          const land = 1 - Math.abs(t - 0.49) / 0.07;
          sy *= 1 - 0.18 * land;
          sx *= 1 + 0.12 * land;
          sz *= 1 + 0.12 * land;
        }
      }
    }
    rig.scale.x *= sx;
    rig.scale.y *= sy;
    rig.scale.z *= sz;
    void info;
  }

  // ---- placed toys, flights, particles --------------------------------------

  function syncPlaced() {
    const spot = rack();
    const rows = [];
    for (const item of ITEMS) {
      const place = places.get(item.id);
      if (place.at === "rack" && spot) rows.push(`${item.id}:r`);
      else if (place.at === "floor") rows.push(`${item.id}:${Math.round(place.x)},${Math.round(place.y)}`);
    }
    const sig = `${world.assetsReady ? 1 : 0}|${spot ? `${spot.x},${spot.y}` : ""}|${rows.join(";")}`;
    if (sig === placedSig) return;
    placedSig = sig;
    for (const node of placed) disposeTree(node);
    placed = [];
    const layer = world.fx;
    if (!layer) return;
    let slot = 0;
    for (const item of ITEMS) {
      const place = places.get(item.id);
      let node = null;
      if (place.at === "rack" && spot) {
        node = makeProp(item, item.rack);
        if (node) {
          // Four to a row: one row on top of the low shelf and one on the middle shelf.
          const col = slot % 4;
          const row = Math.floor(slot / 4);
          const x = spot.x - (spot.w * 3) / 8 + col * (spot.w / 4);
          if (row < 1) node.position.set(x, 34, spot.y);
          else node.position.set(x, 17, spot.y + 2);
        }
        slot += 1;
      } else if (place.at === "floor") {
        node = makeProp(item, item.rack);
        if (node) {
          node.position.set(place.x, 0.5, place.y);
          node.rotation.y = (place.x * 7 + place.y * 3) % 6.28;
        }
      } else slot += place.at === "rack" ? 1 : 0;
      if (!node) continue;
      node.userData.toy = item.id;
      layer.add(node);
      placed.push(node);
    }
  }

  function anchorOf(id, height = 30) {
    const actor = world.actor?.(id);
    if (actor) return new THREE.Vector3(actor.position.x, height, actor.position.z);
    const person = id === state.me?.id ? state.me : state.others.get(id);
    return person ? new THREE.Vector3(person.x, height, person.y) : null;
  }

  function fly(node, from, to, ms, extra = {}) {
    const layer = world.fx;
    const start = anchorOf(from, extra.fromY ?? 30);
    if (!layer || !start || !node) {
      disposeTree(node);
      return;
    }
    layer.add(node);
    node.position.copy(start);
    flights.push({ kind: "toy", node, start, to, ms, t0: performance.now() + (extra.delay || 0), arc: 52, toY: 30, spin: 14, ...extra });
  }

  function roll(from, x, y) {
    const node = makeProp(BY_ID.get("ball"), [7, 7, 7]);
    const layer = world.fx;
    const start = anchorOf(from, 4);
    if (!layer || !start || !node) return;
    layer.add(node);
    flights.push({ kind: "roll", node, start, end: new THREE.Vector3(x, 0.5, y), t0: performance.now(), ms: 480, arc: 0, spin: 14 });
  }

  function dot(color, radius, extra = {}) {
    return part(new THREE.SphereGeometry(radius, 10, 8), color, { transparent: true, ...extra });
  }

  function sparkle(size = 5) {
    stars ||= starTexture();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: stars, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(size);
    sprite.userData.sprite = true;
    return sprite;
  }

  function spawn(node, at, motion) {
    const layer = world.fx;
    if (!layer) return disposeTree(node);
    node.position.copy(at);
    layer.add(node);
    particles.push({ node, t0: performance.now(), life: 1400, vx: 0, vy: 0, vz: 0, spin: 0, gravity: 60, ...motion });
  }

  function headOf(id, below = 0) {
    const top = world.crown?.(id) ?? 60;
    return anchorOf(id, top - below);
  }

  function burst(id, kind) {
    const actor = world.actor?.(id);
    if (!world.fx || !actor) return;
    const top = world.crown?.(id) ?? 60;
    const now = performance.now();
    if (kind === "stars") {
      for (let i = 0; i < 5; i++) {
        const node = sparkle(7);
        world.fx.add(node);
        particles.push({ kind: "orbit", node, id, t0: now, life: 950, angle: (i / 5) * Math.PI * 2, top });
      }
      return;
    }
    const at = new THREE.Vector3(actor.position.x, top - 12, actor.position.z);
    const many = { feathers: 12, splash: 14, sparkles: 10, bubbles: 10 }[kind] || 10;
    for (let i = 0; i < many; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 22 + Math.random() * 26;
      let node;
      let motion = { vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, vy: 26 + Math.random() * 28, spin: (Math.random() - 0.5) * 9, life: 1500 };
      if (kind === "feathers") node = part(new THREE.PlaneGeometry(3.2, 1.2), PASTEL.cream, { side: THREE.DoubleSide, transparent: true });
      else if (kind === "splash") {
        node = dot(PASTEL.sky, 0.9 + Math.random() * 0.6, { opacity: 0.85 });
        motion = { ...motion, vy: 30 + Math.random() * 30, life: 800, gravity: 140 };
      } else if (kind === "sparkles") {
        node = sparkle(3 + Math.random() * 3);
        motion = { ...motion, vy: 10 + Math.random() * 20, life: 1300, gravity: -10 };
      } else {
        node = dot(PASTEL.sky, 1.2 + Math.random() * 1.6, { opacity: 0.45 });
        at.y = top - 20 + Math.random() * 10;
        motion = { vx: Math.cos(a) * 8, vz: Math.sin(a) * 8, vy: 8 + Math.random() * 10, life: 2200, gravity: -6, sway: Math.random() * 6 };
      }
      spawn(node, at, { kind, ...motion });
    }
  }

  function frameHook(dt) {
    syncPlaced();
    const now = performance.now();
    if (state.me) {
      const step = Math.max(1, now - pace.at);
      if (pace.at) pace.speed = pace.speed * 0.8 + (Math.hypot(state.me.x - pace.x, state.me.y - pace.y) / step) * 1000 * 0.2;
      pace = { x: state.me.x, y: state.me.y, at: now, speed: pace.speed };
    }
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      if (now < f.t0) continue;
      const u = Math.min(1, (now - f.t0) / f.ms);
      if (f.kind === "roll") {
        f.node.position.lerpVectors(f.start, f.end, ease(u));
        f.node.position.y += Math.abs(Math.sin(u * Math.PI * 2)) * 4 * (1 - u);
      } else {
        const end = anchorOf(f.to || "", f.toY) || f.start;
        f.node.position.lerpVectors(f.start, end, u);
        f.node.position.y += Math.sin(u * Math.PI) * f.arc;
      }
      f.node.rotation.x += dt * f.spin;
      if (u >= 1) {
        disposeTree(f.node);
        flights.splice(i, 1);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = now - p.t0;
      if (age > p.life) {
        p.node.removeFromParent();
        p.node.material?.dispose?.();
        if (!p.node.userData?.sprite) p.node.geometry?.dispose?.();
        particles.splice(i, 1);
        continue;
      }
      const fade = 1 - age / p.life;
      if (p.kind === "orbit") {
        const actor = world.actor?.(p.id);
        if (!actor) continue;
        const a = p.angle + age / 160;
        p.node.position.set(actor.position.x + Math.cos(a) * 15, p.top + 4 + Math.sin(age / 90) * 2, actor.position.z + Math.sin(a) * 15);
        p.node.material.opacity = fade;
        continue;
      }
      p.vy -= p.gravity * dt;
      const drag = Math.exp(-(p.drag ?? 2.5) * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.node.position.x += (p.vx + (p.sway ? Math.sin(age / 200 + p.sway) * 6 : 0)) * dt;
      p.node.position.y = Math.max(1, p.node.position.y + Math.max(p.vy, -18) * dt);
      p.node.position.z += p.vz * dt;
      p.node.rotation.x += p.spin * dt;
      p.node.rotation.y += p.spin * 0.6 * dt;
      p.node.material.opacity = Math.min(p.kind === "bubbles" ? 0.45 : 1, fade * 1.6);
    }
    if (incoming && now > incoming.until) incoming = null;
    if (pinching && now > pinching.until) pinching = null;
    paintButtons();
  }

  world.setToyHook?.({ actor: actorHook, frame: frameHook });

  // ---- UI -----------------------------------------------------------------

  function button(id, label, onClick) {
    let node = $(id);
    if (node) return node;
    node = document.createElement("button");
    node.type = "button";
    node.id = id;
    node.className = "toy-float";
    node.hidden = true;
    node.textContent = label;
    if (onClick) node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    document.body.appendChild(node);
    return node;
  }

  /** Press-and-hold wiring shared by the phone pinch button and the desktop menu. */
  function holdToPinch(node) {
    const end = (event) => {
      event.preventDefault();
      stopPinch();
    };
    node.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPinch();
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        /* capture is only a nicety; pointerup on the button still ends the pinch */
      }
    });
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
    node.addEventListener("lostpointercapture", end);
    node.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function ensureHold() {
    let node = $("toy-hold");
    if (node) return node;
    node = button("toy-hold", "按住捏臉");
    holdToPinch(node);
    return node;
  }

  // The little menu that pops up next to a coworker on desktop.
  function ensureNear() {
    if (near) return near;
    near = document.createElement("section");
    near.id = "near-menu";
    near.hidden = true;
    near.setAttribute("aria-label", "對同事做的事");
    near.innerHTML = '<div class="who"></div><div class="row"><button type="button" data-near="bump">撞飛<kbd>1</kbd></button><button type="button" data-near="pinch">捏臉<kbd>按住 2</kbd></button><button type="button" data-near="use" hidden></button></div>';
    document.body.appendChild(near);
    const bump = near.querySelector('[data-near="bump"]');
    bump.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      bumpOn(closeBy());
    });
    holdToPinch(near.querySelector('[data-near="pinch"]'));
    near.querySelector('[data-near="use"]').addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const toy = holding();
      const who = target(toy);
      if (who) useOn(who);
    });
    return near;
  }

  function ensureTidy() {
    let node = $("btn-tidy");
    if (node) return node;
    const row = document.querySelector("#dialogue .row");
    if (!row) return null;
    node = document.createElement("button");
    node.type = "button";
    node.id = "btn-tidy";
    node.hidden = true;
    node.textContent = "玩具亂放了，麻煩收回架上";
    node.addEventListener("click", () => send({ t: "toy", op: "tidy" }));
    const later = $("btn-later");
    if (later && later.parentElement === row) row.insertBefore(node, later);
    else row.appendChild(node);
    return node;
  }

  function paintButtons() {
    const busy = env.blocked();
    const catchBtn = button("toy-catch", "接住！", () => catchBall());
    const showCatch = Boolean(incoming) && !busy && performance.now() >= incoming.open;
    if (catchBtn.hidden === showCatch) catchBtn.hidden = !showCatch;
    const who = pinching ? null : closeBy();
    const hold = ensureHold();
    const showHold = env.phone() && !busy && !isOpen() && (Boolean(pinching) || Boolean(who));
    const holdLabel = pinching ? "放開" : who ? `按住捏 @${who.id} 的臉` : "按住捏臉";
    if (hold.textContent !== holdLabel) hold.textContent = holdLabel;
    if (hold.hidden === showHold) hold.hidden = !showHold;
    const box = ensureNear();
    const person = who || (pinching ? state.others.get(pinching.to) : null);
    const showNear = !env.phone() && !busy && !isOpen() && Boolean(person);
    if (box.hidden === showNear) box.hidden = !showNear;
    if (showNear) {
      const title = `@${person.id}`;
      const head = box.querySelector(".who");
      if (head.textContent !== title) head.textContent = title;
      const toy = holding();
      const use = box.querySelector('[data-near="use"]');
      const aim = toy && toy !== "ram" && target(toy)?.id === person.id;
      const label = aim ? `${VERB[toy](person.id)}<kbd>E</kbd>` : "";
      if (use.dataset.label !== label) {
        use.dataset.label = label;
        use.innerHTML = label;
      }
      use.hidden = !aim;
    }
    const dialogue = $("dialogue");
    if (dialogue && !dialogue.hidden) {
      const tidy = ensureTidy();
      const show = messy() > 0;
      if (tidy && tidy.hidden === show) tidy.hidden = !show;
    }
  }

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("section");
    menu.id = "toy-menu";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.setAttribute("aria-labelledby", "toy-title");
    menu.innerHTML = '<div class="who" id="toy-title">玩具架</div><div class="toy-grid"></div><div class="row"><button type="button" class="ghost" id="toy-back">放回架上</button><button type="button" class="ghost" id="toy-close">關閉</button></div>';
    document.body.appendChild(menu);
    menu.querySelector("#toy-close").addEventListener("click", () => close());
    menu.querySelector("#toy-back").addEventListener("click", () => send({ t: "toy", op: "back" }));
    window.addEventListener("keydown", (event) => {
      if (!isOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.startsWith("Arrow")) event.stopImmediatePropagation();
      // 1–7 pick a toy.
      if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const pick = menu.querySelectorAll("button.item")[index];
        if (pick && !pick.disabled) pick.click();
      }
    }, true);
    return menu;
  }

  function paintMenu() {
    const box = ensureMenu();
    const grid = box.querySelector(".toy-grid");
    grid.replaceChildren();
    const mine = holding();
    for (const item of ITEMS) {
      const place = places.get(item.id);
      const free = place.at === "rack";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item";
      button.dataset.toy = item.id;
      button.disabled = !free;
      const name = document.createElement("span");
      name.textContent = item.label;
      const meta = document.createElement("span");
      meta.className = "count";
      meta.textContent = free
        ? "在架上"
        : place.at === "hand"
          ? (place.holder === state.me?.id ? "在你手上" : `@${place.holder}`)
          : place.at === "air" ? "飛行中" : "在地上";
      button.append(name, meta);
      button.setAttribute("aria-label", `${item.label}，${meta.textContent}`);
      button.addEventListener("click", () => {
        if (!button.disabled) send({ t: "toy", op: "take", toy: item.id });
      });
      grid.appendChild(button);
    }
    box.querySelector("#toy-back").hidden = !mine;
  }

  function openMenu() {
    paintMenu();
    const box = ensureMenu();
    box.hidden = false;
    openedAt = performance.now();
    state.path = [];
    (box.querySelector("button.item:not(:disabled)") || box.querySelector("#toy-close"))?.focus();
  }

  function isOpen() {
    return Boolean(menu && !menu.hidden);
  }

  function close() {
    if (menu) menu.hidden = true;
  }

  function dismiss() {
    if (!isOpen()) return false;
    if (performance.now() - openedAt < 400) return true;
    close();
    return true;
  }

  function guard() {
    if (!isOpen()) return;
    if (env.blocked()) close();
  }

  // ---- actions --------------------------------------------------------------

  function catchBall() {
    if (!incoming || performance.now() < incoming.open) return false;
    send({ t: "toy", op: "catch" });
    return true;
  }

  function startPinch() {
    if (pinching) return false;
    const who = closeBy();
    if (!who) return false;
    pinching = { to: who.id, until: performance.now() + 2000 };
    send({ t: "toy", op: "pinch", to: who.id, on: true });
    return true;
  }

  function stopPinch() {
    if (!pinching) return;
    pinching = null;
    send({ t: "toy", op: "pinch", on: false });
  }

  function bumpOn(person) {
    if (!person || state.seat || env.blocked()) return false;
    const now = performance.now();
    if (now - bumpAt < BUMP_COOL_MS) return false;
    bumpAt = now;
    env.flush();
    send({ t: "toy", op: "bump", to: person.id });
    return true;
  }

  function useOn(person) {
    const toy = holding();
    if (!toy || !person || toy === "ram") return false;
    send({ t: "toy", op: "use", to: person.id });
    return true;
  }

  function interact() {
    if (pinching) return true;
    if (catchBall()) return true;
    const toy = holding();
    if (toy && toy !== "ram") {
      const who = target(toy);
      if (who && useOn(who)) return true;
    }
    if (nearRack()) {
      openMenu();
      return true;
    }
    const floor = floorNear();
    if (floor && !toy) {
      send({ t: "toy", op: "take", toy: floor.id });
      return true;
    }
    return false;
  }

  /** Desktop shortcuts next to a coworker: 1 bumps, holding 2 pinches. */
  function key(name, down) {
    if (isOpen() || env.blocked()) {
      if (!down && name === "2") stopPinch();
      return false;
    }
    if (name === "1" && down) return bumpOn(closeBy());
    if (name === "2") {
      if (down) return startPinch();
      stopPinch();
      return true;
    }
    return false;
  }

  // Clicking or tapping the rack opens it when close, otherwise walks over to it.
  function walk(point, seated = false) {
    if (isOpen()) {
      close();
      return true;
    }
    const spot = rack();
    const item = env.hitFurniture(point.x, point.y);
    if (!spot || !item || item.id !== spot.item.id) return false;
    if (nearRack()) openMenu();
    else if (!seated) {
      const stand = env.freeSpot(spot.standX, spot.standY);
      state.path = env.findPath(stand.x, stand.y);
    }
    return true;
  }

  function openNearest() {
    if (!nearRack()) return false;
    openMenu();
    return true;
  }

  function drop() {
    if (!holding()) return false;
    send({ t: "toy", op: "drop" });
    return true;
  }

  // Driving the bumper car into someone knocks them away; walking pace is enough.
  function bumped(id) {
    if (holding() !== "ram" || state.seat || !(state.walking || state.running)) return;
    const now = performance.now();
    if (now - ramAt < RAM_COOL_MS) return;
    const person = state.others.get(id);
    if (!person || person.seat) return;
    ramAt = now;
    env.flush();
    send({ t: "toy", op: "ram", to: id });
  }

  const VERB = {
    hammer: (id) => `用嗶嗶槌敲 @${id}`,
    ball: (id) => `把球丟給 @${id}`,
    pillow: (id) => `用枕頭打 @${id}`,
    bubble: (id) => `對 @${id} 吹泡泡`,
    water: (id) => `用水槍噴 @${id}`,
    wand: (id) => `對 @${id} 施魔法`,
  };

  function prompt() {
    if (incoming) return "按 E 接住球！";
    const toy = holding();
    if (toy) {
      const who = target(toy);
      if (toy === "ram") return "開著撞撞車去撞同事 · Q 放下";
      if (who) return `按 E ${VERB[toy](who.id)} · Q 放下`;
      if (nearRack()) return "按 E 打開玩具架（可以放回去）";
      return "";
    }
    if (nearRack()) return "按 E 拿玩具";
    const floor = floorNear();
    if (floor) return `按 E 撿起${BY_ID.get(floor.id).label}`;
    return "";
  }

  /** True when the toy hint should win over whisper and seat hints. */
  function urgent() {
    if (incoming) return true;
    const toy = holding();
    return Boolean(toy && (toy === "ram" || target(toy)));
  }

  function actions() {
    const list = [];
    const toy = holding();
    const who = closeBy();
    if (who) list.push({ id: "toy-bump", label: `撞飛 @${who.id}`, run: () => bumpOn(who) });
    if (toy) {
      const aim = toy === "ram" ? null : target(toy);
      if (aim) list.push({ id: "toy-use", label: VERB[toy](aim.id), run: () => useOn(aim) });
      if (nearRack()) list.push({ id: "toy-rack", label: "玩具架", run: () => openMenu() });
      list.push({ id: "toy-drop", label: "放下玩具", run: () => drop() });
      return list;
    }
    if (nearRack()) list.push({ id: "toy-rack", label: "拿玩具", run: () => openMenu() });
    const floor = floorNear();
    if (floor) list.push({ id: "toy-pick", label: `撿起${BY_ID.get(floor.id).label}`, run: () => send({ t: "toy", op: "take", toy: floor.id }) });
    return list;
  }

  // ---- network --------------------------------------------------------------

  function placeAfterKnock(fx) {
    if (!fx.knock) return;
    if (fx.to === state.me?.id) env.placeMe(fx.x, fx.y);
    else {
      const person = state.others.get(fx.to);
      if (person) {
        person.tx = fx.x;
        person.ty = fx.y;
      }
    }
  }

  function later(ms, run) {
    setTimeout(run, ms);
  }

  function play(fx) {
    const now = performance.now();
    log.push({ ...fx, at: now });
    if (log.length > 40) log.shift();
    const kind = fx.kind;
    if (kind === "bonk") {
      fxOf(fx.by).swing = { t0: now };
      fxOf(fx.to).squash = now + 120;
      fxOf(fx.to).low = 1;
      later(120, () => {
        burst(fx.to, "stars");
        if (heard(fx.to)) sound("squeak");
      });
      emote(fx.to, "嗶！", 1400);
    } else if (kind === "pillow") {
      fxOf(fx.by).swing = { t0: now };
      fxOf(fx.to).wobble = now + 100;
      later(100, () => {
        burst(fx.to, "feathers");
        if (heard(fx.to)) sound("pillow");
      });
    } else if (kind === "throw") {
      fxOf(fx.by).swing = { t0: now };
      fly(makeProp(BY_ID.get("ball"), [7, 7, 7]), fx.by, fx.to, fx.ms || 900);
      if (heard(fx.by)) sound("throw");
      if (fx.to === state.me?.id) incoming = { open: now + CATCH_OPEN_MS, until: now + (fx.ms || 900) + CATCH_GRACE_MS, by: fx.by };
    } else if (kind === "catch") {
      if (fx.by === state.me?.id) incoming = null;
      fxOf(fx.by).squash = now;
      emote(fx.by, fx.combo > 1 ? `接到了！連續 ${fx.combo} 次` : "接到了！", 2200);
      if (heard(fx.by)) sound("catch");
    } else if (kind === "fall") {
      if (fx.to === state.me?.id) incoming = null;
      roll(fx.to, fx.x, fx.y);
      emote(fx.to, "沒接到～", 1600);
    } else if (kind === "bubble") {
      fxOf(fx.by).swing = { t0: now };
      for (let i = 0; i < 7; i++) fly(dot(PASTEL.sky, 1.4 + (i % 3) * 0.5, { opacity: 0.5 }), fx.by, fx.to, 700, { delay: i * 60, arc: 10 + i * 2, fromY: 24, toY: 32, spin: 2 });
      later(650, () => {
        burst(fx.to, "bubbles");
        fxOf(fx.to).float = performance.now();
        emote(fx.to, "飄起來了～", 2000);
      });
      if (heard(fx.by)) sound("bubble");
    } else if (kind === "water") {
      fxOf(fx.by).swing = { t0: now };
      for (let i = 0; i < 9; i++) fly(dot(PASTEL.sky, 0.9, { opacity: 0.85 }), fx.by, fx.to, 320, { delay: i * 35, arc: 8, fromY: 22, toY: 30, spin: 0 });
      later(360, () => {
        burst(fx.to, "splash");
        fxOf(fx.to).shake = performance.now();
        emote(fx.to, "好冰！", 1600);
      });
      if (heard(fx.by)) sound("water");
    } else if (kind === "wand") {
      fxOf(fx.by).swing = { t0: now };
      fly(sparkle(8), fx.by, fx.to, 450, { arc: 20, fromY: 34, toY: 40, spin: 0 });
      later(450, () => {
        burst(fx.to, "sparkles");
        fxOf(fx.to).tiny = performance.now();
        fxOf(fx.to).small = 1;
        emote(fx.to, "變小了！", 1600);
      });
      if (heard(fx.by)) sound("wand");
    } else if (kind === "pinch") {
      if (fx.on) {
        fxOf(fx.to).pinch = { on: true, t0: now, until: now + (fx.ms || 2000) };
        fxOf(fx.by).pinchBy = { until: now + (fx.ms || 2000) };
        if (heard(fx.to)) sound("pinch");
      } else {
        const p = effects.get(fx.to)?.pinch;
        if (p?.on) {
          p.on = false;
          p.off = now;
        }
        if (effects.get(fx.by)) effects.get(fx.by).pinchBy = null;
        if (fx.by === state.me?.id) pinching = null;
      }
    } else if (kind === "ram" || kind === "bump") {
      world.nudge?.(fx.by, -fx.nx, -fx.ny);
      if (fx.knock) {
        fxOf(fx.to).spin = now;
        placeAfterKnock(fx);
        if (heard(fx.to)) sound("boing");
        if (kind === "bump") emote(fx.to, "哇啊～", 1400);
      } else {
        fxOf(fx.to).wobble = now;
        world.nudge?.(fx.to, fx.nx, fx.ny);
      }
    } else if (kind === "tidy") {
      if (fx.by === state.me?.id) {
        const text = $("dialogue-text");
        if (text && !$("dialogue").hidden) text.textContent = fx.count > 0 ? `好的，${fx.count} 個玩具都收回玩具架了。` : "玩具都好好地在架上喔。";
        const tidy = $("btn-tidy");
        if (tidy) tidy.hidden = true;
      }
    } else if (kind === "hold" && fx.by === state.me?.id) close();
    else if (kind === "back" && fx.by === state.me?.id) paintMenu();
  }

  function onNet(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "welcome") {
      for (const [, pose] of held) release(pose.actor, pose);
      held.clear();
      effects.clear();
      incoming = null;
      pinching = null;
      if (message.toys) applyView(message.toys);
      return;
    }
    if (message.t === "leave" && typeof message.id === "string") {
      effects.delete(message.id);
      return;
    }
    if (message.t === "error" && message.toy && state.me) {
      if (message.toy === "early") return;
      emote(state.me.id, message.message, 1800);
      if (message.toy === "late") incoming = null;
      if (pinching && message.toy !== "late") pinching = null;
      return;
    }
    if (message.t !== "toys") return;
    applyView(message);
    if (message.fx && typeof message.fx.kind === "string") play(message.fx);
  }

  return {
    onNet,
    interact,
    key,
    walk,
    openNearest,
    drop,
    bumped,
    prompt,
    urgent,
    actions,
    isOpen,
    close,
    dismiss,
    guard,
    release: stopPinch,
    holding,
    bump: () => bumpOn(closeBy()),
    view() {
      return {
        toys: Object.fromEntries([...places].map(([id, place]) => [id, { ...place }])),
        combo,
        incoming: Boolean(incoming),
        catchable: Boolean(incoming) && performance.now() >= incoming.open,
        pinching: Boolean(pinching),
        near: closeBy()?.id || "",
        messy: messy(),
        flights: flights.length,
        particles: particles.length,
        placed: placed.map((node) => node.userData.toy),
        items: ITEMS.map((item) => item.id),
      };
    },
    fxLog() {
      return log.map((row) => ({ ...row }));
    },
    squashOf(id) {
      const actor = world.actor?.(id);
      if (!actor?.userData?.rig) return null;
      const fx = effects.get(id);
      return { x: actor.userData.rig.scale.x, y: actor.userData.rig.scale.y, low: fx?.low ?? 1, small: fx?.small ?? 1, busy: Boolean(fx?.squash || fx?.tiny) };
    },
    heldProp(id) {
      const pose = held.get(id);
      return pose?.prop ? pose.toy : "";
    },
    rack,
  };
}
